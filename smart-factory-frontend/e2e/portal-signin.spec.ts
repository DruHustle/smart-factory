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
  const button=page.getByRole("button",{name:"Sign in with Onesa",exact:true});await expect(button).toBeVisible();await button.click();
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
  await expect(page.getByRole("button",{name:"Sign in with Onesa",exact:true})).toBeVisible();
  expect(calls).toContain("auth.logout");
});
