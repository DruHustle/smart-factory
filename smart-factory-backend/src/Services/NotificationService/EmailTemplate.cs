// Palette mirrors smart-factory-frontend/client/src/index.css, including orange/cyan dark mode.
using System.Net;
using System.Text.RegularExpressions;

namespace SmartFactory.Services.NotificationService;

/// <summary>HTML is a presentation alternative; the original plain text is retained.</summary>
public static class EmailTemplate
{
    private const string Shell = """
<!doctype html>
<html lang="@@LANG@@"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>@@TITLE@@</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}body{margin:0;padding:0}table{border-collapse:collapse}img{border:0;outline:none;text-decoration:none}a:focus-visible{outline:3px solid @@ACCENT@@;outline-offset:4px}p{margin:0 0 18px}@media(max-width:620px){.outer{padding:20px 12px!important}.content{padding:28px 22px!important}.heading{font-size:27px!important;line-height:33px!important}.footer{padding:24px 22px!important}}@media(prefers-color-scheme:dark){.canvas{background:#0a0e27!important}.card{background:#111d3d!important;border-color:#30415e!important}.ink{color:#e8ecf1!important}.copy{color:#c8d4e4!important}.muted{color:#a3b3c7!important}.panel,.notice{background:#2d2540!important;border-color:#ff8c42!important}.rule{border-color:#30415e!important}.url{color:#67e8f9!important}.accent-fill,.button{background:#ff8c42!important;color:#0a0e27!important}.button-label{color:#0a0e27!important;border-color:#ff8c42!important}}</style></head>
<body class="canvas" style="background:#f3f6fb;color:#17233a;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">@@PREHEADER@@</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="outer" align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #cbd5e1;border-radius:16px;border-collapse:separate;border-spacing:0;">
<tr><td class="accent-fill" style="height:4px;background:@@ACCENT@@;border-radius:15px 15px 0 0;font-size:0;line-height:4px;">&nbsp;</td></tr>
<tr><td class="content" style="padding:36px 40px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;"><tr><td width="44" style="width:44px;vertical-align:middle;"><img src="cid:onesa-company-logo" width="44" height="44" alt="" style="display:block;width:44px;height:44px;"></td><td style="padding-left:12px;"><div class="ink" style="font-size:23px;line-height:28px;font-weight:700;letter-spacing:3px;color:#17233a;">ONESA</div><div class="muted" style="margin-top:3px;font-size:11px;line-height:17px;letter-spacing:.6px;color:#52637a;">@@BRAND@@</div></td></tr></table>
<h1 class="heading ink" style="margin:0 0 18px;font-size:32px;line-height:39px;font-weight:700;letter-spacing:-.7px;color:#17233a;overflow-wrap:anywhere;">@@HEADING@@</h1>
<div class="copy" style="font-size:16px;line-height:27px;color:#52637a;overflow-wrap:anywhere;word-break:break-word;">@@CONTENT@@</div>
@@ACTION@@
@@FALLBACK@@
<div class="notice" style="margin:28px 0 0;padding:16px 18px;background:@@SOFT@@;border-left:3px solid @@ACCENT@@;border-radius:0 8px 8px 0;"><p class="muted" style="margin:0;font-size:13px;line-height:22px;color:#52637a;">@@NOTE@@</p></div>
</td></tr>
<tr><td class="footer rule" style="padding:24px 40px 28px;border-top:1px solid #cbd5e1;border-radius:0 0 15px 15px;">
<p class="muted" style="margin:0 0 14px;font-size:11px;line-height:18px;color:#52637a;">@@FOOTER@@</p>
<p class="muted" style="margin:0 0 8px;font-size:12px;line-height:20px;color:#52637a;"><strong>Onesa UG (haftungsbeschränkt)</strong><br>Steinhofweg 47, 69123 Heidelberg, Germany<br>Geschäftsführer / Managing Director: Andrew Gotora<br>Amtsgericht Mannheim, HRB 757830</p>
<p class="muted" style="margin:0;font-size:12px;line-height:20px;color:#52637a;"><a class="url" href="mailto:info@onesa.eu" style="color:#0e7490;text-decoration:underline;">info@onesa.eu</a> &nbsp;&middot;&nbsp; +49 151 474 16152</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>
""";
    private static string Escape(string value) => WebUtility.HtmlEncode(value);

    public static string Render(string title, string body, long notificationId, string? configuredOrigin = null)
    {
        var reset = notificationId < 0;
        var value = configuredOrigin ?? "https://factory.onesa.eu";
        var origin = Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback)) &&
            uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0
            ? uri.GetLeftPart(UriPartial.Authority) : null;
        string? action = null;
        if (reset && origin is not null)
            action = body.Split('\n').Select(line => line.Trim()).FirstOrDefault(line =>
                line.StartsWith(origin + "/#/reset-password?token=", StringComparison.Ordinal) &&
                Regex.IsMatch(line[(origin.Length + "/#/reset-password?token=".Length)..], "\\A[A-Za-z0-9_-]{43}\\z"));
        else if (!reset && origin is not null) action = origin + "/#/";
        var copy = reset && action is not null ? string.Join('\n', body.Split('\n').Where(line => line.Trim() != action)) : body;
        var paragraphs = string.Concat(Regex.Split(copy, @"\n\s*\n").Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => "<p style=\"margin:0 0 18px;\">" + Escape(p).Replace("\n", "<br>") + "</p>"));
        var button = action is null ? "" : "<table role=\"presentation\" style=\"margin:28px 0 8px;\"><tr><td class=\"button\" bgcolor=\"#c2410c\" style=\"background:#c2410c;border-radius:8px;mso-padding-alt:16px 24px;\"><a class=\"button-label\" href=\"" + Escape(action) + "\" style=\"display:inline-block;padding:16px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;line-height:20px;border:1px solid #c2410c;border-radius:8px;\">" + (reset ? "Reset password" : "Open Smart Factory") + " &nbsp;&#8594;</a></td></tr></table>";
        var fallback = !reset || action is null ? "" : "<p class=\"muted\" style=\"font-size:12px;line-height:20px;margin:24px 0 0;\">If the button does not open, copy this link into your browser:</p><p style=\"font-size:11px;line-height:18px;margin:8px 0 0;word-break:break-all;\"><a class=\"url\" href=\"" + Escape(action) + "\" style=\"color:#c2410c;\">" + Escape(action) + "</a></p>";
        var fields = new Dictionary<string, string> {
            ["LANG"] = "en", ["TITLE"] = Escape(title), ["PREHEADER"] = reset ? "A secure link to choose a new Smart Factory password." : Escape(title),
            ["BRAND"] = "Smart Factory", ["MONOGRAM"] = "SF", ["ACCENT"] = "#c2410c", ["SOFT"] = "#ffedd5",
            ["LABEL"] = reset ? "ACCOUNT SECURITY" : title == "Welcome to Smart Factory" ? "WELCOME TO YOUR WORKSPACE" : "WORKSPACE UPDATE",
            ["HEADING"] = reset ? "Reset your password" : Escape(title), ["CONTENT"] = paragraphs, ["ACTION"] = button, ["FALLBACK"] = fallback,
            ["NOTE"] = reset ? "Keep this link private. Smart Factory will never ask you to share your password or recovery link." : "Open your workspace to review the latest information and take any required action.",
            ["FOOTER"] = "Automated message from your factory workspace.",
        };
        return Regex.Replace(Shell, "@@([A-Z]+)@@", match => fields.GetValueOrDefault(match.Groups[1].Value, ""));
    }
}
