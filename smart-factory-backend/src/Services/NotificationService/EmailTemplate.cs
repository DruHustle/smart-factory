using System.Net;
using System.Text.RegularExpressions;

namespace SmartFactory.Services.NotificationService;

/// <summary>HTML is a presentation alternative; the original plain text is retained.</summary>
public static class EmailTemplate
{
    private const string Shell = """
<!doctype html>
<html lang="@@LANG@@"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>@@TITLE@@</title>
<style>body{margin:0;padding:0}table{border-collapse:collapse}a{color:@@ACCENT@@}p{margin:0 0 18px} @media(max-width:620px){.outer{padding:24px 12px!important}.content{padding:28px 24px!important}.heading{font-size:28px!important;line-height:34px!important}.brand{padding:24px!important}.footer{padding:24px 12px!important}} @media(prefers-color-scheme:dark){.canvas{background:#101923!important}.card,.brand{background:#172431!important}.ink{color:#f0f5fa!important}.copy{color:#c1cdd9!important}.muted{color:#a5b6c7!important}.panel{background:#213342!important;border-color:#3c5568!important}.rule{border-color:#334756!important}.url{color:#9ddbeb!important}}</style></head>
<body class="canvas" style="background:#f1f4f7;color:#172b3d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">@@PREHEADER@@</div>
<table role="presentation" width="100%" class="canvas" style="background:#f1f4f7;"><tr><td class="outer" align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" class="card" style="max-width:600px;background:#ffffff;border:1px solid #dce4eb;border-radius:16px;">
<tr><td style="height:5px;background:@@ACCENT@@;font-size:1px;line-height:5px;">&nbsp;</td></tr>
<tr><td class="brand rule" style="padding:28px 36px;border-bottom:1px solid #e5ebf0;"><table role="presentation" width="100%"><tr><td width="44" style="width:44px;"><table role="presentation"><tr><td align="center" width="40" height="40" style="width:40px;height:40px;background:@@ACCENT@@;color:#ffffff;border-radius:10px;font-size:15px;font-weight:bold;letter-spacing:-.5px;">@@MONOGRAM@@</td></tr></table></td><td style="padding-left:12px;"><div class="muted" style="font-size:10px;line-height:15px;letter-spacing:2px;color:#63788c;font-weight:bold;">ONESA</div><div class="ink" style="font-size:18px;line-height:24px;font-weight:bold;color:#172b3d;">@@BRAND@@</div></td></tr></table></td></tr>
<tr><td class="content" style="padding:36px;">
<p class="muted" style="font-size:11px;line-height:16px;letter-spacing:1.8px;color:#536b80;font-weight:bold;margin:0 0 14px;">@@LABEL@@</p>
<h1 class="heading ink" style="font-size:32px;line-height:39px;letter-spacing:-.8px;color:#172b3d;margin:0 0 24px;font-weight:700;overflow-wrap:anywhere;">@@HEADING@@</h1>
<div class="copy" style="font-size:16px;line-height:26px;color:#52677a;overflow-wrap:anywhere;word-break:break-word;">@@CONTENT@@</div>
@@ACTION@@
@@FALLBACK@@
</td></tr>
<tr><td class="panel rule" style="padding:20px 36px;background:@@SOFT@@;border-top:1px solid #e5ebf0;"><p class="muted" style="font-size:12px;line-height:20px;color:#5b7284;margin:0;">@@NOTE@@</p></td></tr>
</table>
<table role="presentation" width="100%" style="max-width:600px;"><tr><td class="footer muted" align="center" style="padding:24px 20px;color:#687e90;font-size:11px;line-height:19px;letter-spacing:.2px;">@@BRAND@@ &nbsp;&middot;&nbsp; ONESA<br>@@FOOTER@@</td></tr></table>
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
        var button = action is null ? "" : "<table role=\"presentation\" style=\"margin:28px 0 8px;\"><tr><td bgcolor=\"#086c76\" style=\"background:#086c76;border-radius:8px;mso-padding-alt:16px 24px;\"><a href=\"" + Escape(action) + "\" style=\"display:inline-block;padding:16px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;line-height:20px;border:1px solid #086c76;border-radius:8px;\">" + (reset ? "Reset password" : "Open Smart Factory") + " &nbsp;&#8594;</a></td></tr></table>";
        var fallback = !reset || action is null ? "" : "<p class=\"muted\" style=\"font-size:12px;line-height:20px;margin:24px 0 0;\">If the button does not open, copy this link into your browser:</p><p style=\"font-size:11px;line-height:18px;margin:8px 0 0;word-break:break-all;\"><a class=\"url\" href=\"" + Escape(action) + "\" style=\"color:#086c76;\">" + Escape(action) + "</a></p>";
        var fields = new Dictionary<string, string> {
            ["LANG"] = "en", ["TITLE"] = Escape(title), ["PREHEADER"] = reset ? "A secure link to choose a new Smart Factory password." : Escape(title),
            ["BRAND"] = "Smart Factory", ["MONOGRAM"] = "SF", ["ACCENT"] = "#086c76", ["SOFT"] = "#eef6f7",
            ["LABEL"] = reset ? "ACCOUNT SECURITY" : title == "Welcome to Smart Factory" ? "WELCOME TO YOUR WORKSPACE" : "WORKSPACE UPDATE",
            ["HEADING"] = reset ? "Reset your password" : Escape(title), ["CONTENT"] = paragraphs, ["ACTION"] = button, ["FALLBACK"] = fallback,
            ["NOTE"] = reset ? "Keep this link private. Smart Factory will never ask you to share your password or recovery link." : "Open your workspace to review the latest information and take any required action.",
            ["FOOTER"] = "Automated message from your factory workspace.",
        };
        return Regex.Replace(Shell, "@@([A-Z]+)@@", match => fields.GetValueOrDefault(match.Groups[1].Value, ""));
    }
}
