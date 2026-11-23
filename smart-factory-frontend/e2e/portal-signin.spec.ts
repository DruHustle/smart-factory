import {expect,test,type Page} from "@playwright/test";
import superjson from "superjson";
import {requiredCapabilities,runtimeContractVersion} from "../shared/runtime-contract";

async function fixture(page:Page,pending=false) {
  const calls:string[]=[];
  await page.route("**/api/runtime/contract",route=>route.fulfill({json:{contractVersion:runtimeContractVersion,capabilities:requiredCapabilities,schema:{ready:true},versioned:true}}));
  await page.route("**/api/auth/onesa/config",route=>route.fulfill({json:{enabled:true}}));
  await page.route("**/api/trpc/**",async route=>{
    const url=new URL(route.request().url()),batch=url.searchParams.get("batch")==="1";
    const names=decodeURIComponent(url.pathname.split("/trpc/")[1]).split(",");
    const data=names.map(name=>{
      calls.push(name);if(name==="auth.logout")pending=false;
      const value=name==="auth.me"&&pending?{id:17,openId:"onesa-fixture",email:"member@example.test",name:"Synthetic member",role:"viewer",access:{provisioningRequired:true,canOperate:false,canEngineer:false,canAdminister:false}}:name==="auth.demoAccounts"?[]:name==="auth.logout"?{success:true}:null;
      return {result:{data:superjson.serialize(value)}};
    });
    await route.fulfill({json:batch?data:data[0]});
  });
  return calls;
}

test("Onesa sign-in carries a protected destination and keeps a useful retry after provider failure",async({page})=>{
  await fixture(page);let body:any;
  await page.route("**/api/auth/onesa/start",async route=>{body=route.request().postDataJSON();await route.fulfill({status:503,json:{error:"unavailable"}});});
  await page.setViewportSize({width:320,height:844});
  await page.goto("/#/monitoring?asset=17");
  const button=page.getByRole("button",{name:"Continue with Onesa",exact:true});await expect(button).toBeVisible();await button.click();
  await expect(page.getByText("Onesa sign-in could not be completed. Check your details and try again.")).toBeVisible();
  expect(body.returnTo).toBe("#/monitoring?asset=17");await expect(button).toBeEnabled();
});

test("a pending Portal account displays approval status, requests no factory records and can sign out",async({page})=>{
  const calls=await fixture(page,true);
  await page.goto("/#/monitoring?asset=17");
  await expect(page.getByRole("heading",{name:"Your Onesa account is signed in"})).toBeVisible();
  await expect(page.getByText("member@example.test")).toBeVisible();
  expect(calls.filter(name=>!name.startsWith("auth."))).toEqual([]);
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("button",{name:"Continue with Onesa",exact:true})).toBeVisible();
  expect(calls).toContain("auth.logout");
});

test("hosted Factory delegates registration and recovery through the configured account route", async ({ page, baseURL }) => {
  await fixture(page);
  await page.route("**/api/auth/onesa/config", route => route.fulfill({ status: 503, json: {} }));
  const registration = "https://account.onesa.eu/register?audience=user&product=factory&platform=web";
  await page.route("https://account.onesa.eu/register?**", route => route.fulfill({contentType: "text/html", body:"<h1>Registration route reached</h1>"}));
  const hosted = new URL("/#/monitoring", baseURL);
  hosted.hostname = "factory.localhost";
  await page.goto(hosted.href);
  await expect(page.getByRole("button", { name: "Retry Onesa sign-in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "open your Onesa account" })).toHaveCount(0);
  await page.getByRole("link", { name: "Create an Onesa account", exact: true }).click();
  await expect(page.getByRole("heading", {name:"Registration route reached"})).toBeVisible();
  await expect(page).toHaveURL(registration);
});


test("a Portal link opens the shared sign-in flow and retains the Factory bookmark", async ({ page, baseURL }) => {
  await fixture(page);
  const entry = new URL("/login", baseURL);
  entry.hostname = "factory.localhost";
  entry.searchParams.set("returnTo", "#/monitoring?asset=17");
  await page.route("**/api/auth/onesa/start", route => {
    expect(route.request().postDataJSON()).toEqual({ returnTo: "#/monitoring?asset=17" });
    return route.fulfill({json: {url: "https://identity.example.test/authorize"}});
  });
  await page.route("https://identity.example.test/authorize", route => route.fulfill({contentType: "text/html", body: "<h1>Onesa sign-in</h1>"}));
  await page.goto(entry.href);
  await expect(page.getByLabel("Password", {exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "Continue with Onesa", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Onesa sign-in"})).toBeVisible();
});

test("hosted registration presents both central enrollment tiers without local credentials", async ({ page, baseURL }) => {
  await fixture(page);
  const entry = new URL("/#/register", baseURL);
  entry.hostname = "factory.localhost";
  const user = "https://account.onesa.eu/register?audience=user&product=factory&platform=web";
  const admin = "https://account.onesa.eu/register?audience=admin&product=factory&platform=web";
  await page.route("https://account.onesa.eu/register?**", route => route.fulfill({contentType: "text/html", body: "<h1>Onesa Account registration</h1>"}));
  await page.goto(entry.href);
  await expect(page.getByRole("heading", {name: "Create your Onesa account"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Register as a user"})).toHaveAttribute("href", user);
  await expect(page.getByRole("link", {name: "Request administrator access"})).toHaveAttribute("href", admin);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole("link", {name: "Register as a user"}).click();
  await expect(page).toHaveURL(user);
  await expect(page.getByRole("heading", {name: "Onesa Account registration"})).toBeVisible();
});

test("hosted password recovery routes only to Onesa sign-in and never forwards a reset token", async ({page,baseURL})=>{
  await fixture(page);
  const hosted = new URL("/#/forgot-password", baseURL);
  hosted.hostname = "factory.localhost";
  const account = "https://account.onesa.eu/login";
  await page.route(account, route => route.fulfill({contentType:"text/html",body:"<h1>Onesa sign-in</h1>"}));
  await page.goto(hosted.href);
  await expect(page.getByRole("heading",{name:"Recover your Onesa account"})).toBeVisible();
  const link = page.getByRole("link",{name:"Open Onesa sign-in"});
  await expect(link).toHaveAttribute("href",account);
  await page.goto(hosted.origin+"/#/reset-password?token=synthetic.private.value");
  await expect(page).toHaveURL(account);
  await expect(page.getByRole("heading",{name:"Onesa sign-in"})).toBeVisible();
});

test("Identity registration returns to Factory before resuming the bookmarked asset", async ({page,baseURL})=>{
  await fixture(page);
  const hosted = new URL("/#/monitoring?asset=17",baseURL);
  hosted.hostname = "factory.localhost";
  const registration = "https://account.onesa.eu/register?audience=user&product=factory&platform=web";
  await page.route("https://account.onesa.eu/**",route=>route.fulfill({contentType:"text/html",body:'<a href="'+hosted.origin+'/#/login?registration=complete">Back to Factory</a>'}));
  await page.route("**/api/auth/onesa/start",route=>{
    expect(route.request().postDataJSON()).toEqual({returnTo:"#/monitoring?asset=17"});
    return route.fulfill({json:{url:"https://identity.example.test/authorize"}});
  });
  await page.route("https://identity.example.test/authorize",route=>route.fulfill({body:"Onesa sign-in"}));
  await page.goto(hosted.href);
  await page.getByRole("link",{name:"Create an Onesa account",exact:true}).click();
  await expect(page).toHaveURL(registration);
  await page.getByRole("link",{name:"Back to Factory"}).click();
  await expect(page).toHaveURL("https://identity.example.test/authorize");
});

test("Identity registration opens the Factory workspace when verification returns in a fresh tab", async ({page,baseURL})=>{
  await fixture(page);
  const hosted = new URL("/#/login?registration=complete",baseURL);
  hosted.hostname = "factory.localhost";
  await page.route("**/api/auth/onesa/start",route=>{
    expect(route.request().postDataJSON()).toEqual({returnTo:"#/"});
    return route.fulfill({json:{url:"https://identity.example.test/authorize"}});
  });
  await page.route("https://identity.example.test/authorize",route=>route.fulfill({body:"Onesa sign-in"}));
  await page.goto(hosted.href);
  await expect(page).toHaveURL("https://identity.example.test/authorize");
});
