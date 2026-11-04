using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using SmartFactory.Services.NotificationService;

namespace SmartFactory.Tests;

public class EmailTemplateTests
{
    [Fact]
    public void DynamicContentCannotIntroduceMarkupOrReplaceTemplateSlots()
    {
        var html = EmailTemplate.Render("<img src=x onerror=alert(1)>", "<script>bad()</script>\n\n@@ACTION@@ & details", 1);
        Assert.DoesNotContain("<script>", html);
        Assert.DoesNotContain("<img src=x", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("@@ACTION@@ &amp; details", html);
        Assert.Contains("https://factory.onesa.eu/#/", html);
    }

    [Fact]
    public void RecoveryButtonUsesOnlyTheConfiguredOriginAndCompleteToken()
    {
        var link = "https://factory.onesa.eu/#/reset-password?token=" + new string('a', 43);
        var html = EmailTemplate.Render("Reset your Smart Factory password", "Choose a new password:\n" + link + "\n\nThis link expires soon.", -1);
        Assert.Contains("href=\"" + link + "\"", html);
        Assert.Contains("Reset your password", html);
        Assert.Contains("This link expires soon.", html);
        var foreign = EmailTemplate.Render("Reset", "https://attacker.example/#/reset-password?token=" + new string('a', 43), -2);
        Assert.DoesNotContain("href=", foreign);
        var malformed = EmailTemplate.Render("Reset", link + "\" onclick=\"attack()", -3);
        Assert.DoesNotContain("href=", malformed);
    }

    [Fact]
    public async Task ResendSendsHtmlAlongsideUnchangedTextAndDeliveryIdentity()
    {
        var handler = new CaptureHandler();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["RESEND_API_KEY"] = "re_test", ["RESEND_FROM"] = "Smart Factory <notifications-factory@onesa.eu>",
            ["RESEND_ALLOWED_RECIPIENT_DOMAINS"] = "example.org",
        }).Build();
        using var client = new HttpClient(handler) { BaseAddress = new Uri("https://api.resend.com/") };
        await new ResendMailSender(client, config).Send("test@example.org", "Equipment update", "Pump A requires review.\nNo action has been taken.", 82, CancellationToken.None);
        using var payload = JsonDocument.Parse(handler.Body!);
        Assert.Equal("Pump A requires review.\nNo action has been taken.", payload.RootElement.GetProperty("text").GetString());
        Assert.Contains("Equipment update", payload.RootElement.GetProperty("html").GetString());
        Assert.Equal("smart-factory-notification/82", handler.Identity);
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }
        public string? Identity { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Body = await request.Content!.ReadAsStringAsync(ct);
            Identity = request.Headers.GetValues("Idempotency-Key").Single();
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }
}
