import { Activity, Boxes, Factory, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoPassportPath } from "@shared/demo-passport";

const features = [
  {
    icon: Boxes,
    title: "Assets and devices",
    description:
      "Find equipment, see where it is installed and open its service history.",
    sample: "Packaging line · Conveyor C-04 · In service",
    path: "/inventory",
  },
  {
    icon: Activity,
    title: "Telemetry and layouts",
    description:
      "See readings in context and distinguish a stale observation from a current alarm.",
    sample: "Compressor A · 6.8 bar · 09:42",
    path: "/monitoring",
  },
  {
    icon: ShieldAlert,
    title: "Alerts and incidents",
    description:
      "Investigate an alert, assign a response and record the resolution.",
    sample: "Cooling pump · High vibration · Acknowledged",
    path: "/alerts",
  },
  {
    icon: Wrench,
    title: "Maintenance history",
    description:
      "Review equipment service records alongside its condition and asset details.",
    sample: "Conveyor C-04 · Belt inspection · Completed",
    path: "/inventory?view=assets",
  },
];

const samplePassport = demoPassportPath({
  assetId: "sample-conveyor-c04",
  name: "Packaging conveyor C-04",
  assetType: "Conveyor",
  manufacturer: "Training example",
  model: "Demo C04",
  serialNumber: "SAMPLE-004",
  zone: "Packaging",
});

export default function FactoryWelcome() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <span className="inline-flex items-center gap-2 font-semibold">
            <Factory aria-hidden="true" className="size-5 text-primary" />
            Smart Factory
          </span>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="#/login">Sign in</a>
            </Button>
            <Button asChild variant="outline">
              <a href="#/register">Create account</a>
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          See what is happening on your factory floor
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Smart Factory helps plant operators, maintenance teams and engineers
          track equipment, investigate incidents and review service history.
        </p>
        <section aria-labelledby="factory-feature-tour" className="mt-10">
          <h2 id="factory-feature-tour" className="text-xl font-semibold">
            Explore with sample data
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {features.map(
              ({ icon: Icon, title, description, sample, path }) => (
                <article
                  key={title}
                  className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-5"
                >
                  <Icon aria-hidden="true" className="size-5 text-primary" />
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                  <p className="rounded-md bg-muted p-3 text-sm">{sample}</p>
                  <Button asChild variant="outline" className="mt-auto">
                    <a
                      href={`#/login?returnTo=${encodeURIComponent("#" + path)}`}
                    >
                      Open {title.toLowerCase()}
                    </a>
                  </Button>
                </article>
              ),
            )}
          </div>
          <Button asChild variant="secondary" className="mt-5">
            <a href={"#" + samplePassport}>View a sample product passport</a>
          </Button>
        </section>
      </div>
    </main>
  );
}
