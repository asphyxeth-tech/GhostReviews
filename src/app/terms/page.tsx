import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = {
  title: "Terms of Service — Ghost Reviews",
  description: "The terms governing your use of Ghost Reviews.",
};

export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-mono text-base">
            <Wordmark />
          </Link>
          <Link
            href="/"
            className="text-sm text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
          >
            ← Home
          </Link>
        </div>
      </header>

      <main className="px-6 py-10 sm:px-10">
        <article className="mx-auto max-w-3xl text-[color:var(--muted-strong)]">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Last updated: June 23, 2026
          </p>

          <p className="mt-6 leading-relaxed">
            These Terms govern your use of Ghost Reviews (&quot;we,&quot;
            &quot;us,&quot; &quot;our&quot;), operated from Ontario, Canada. By
            using our website or services, you agree to these Terms.
          </p>

          <Section title="1. What we do">
            <p className="leading-relaxed">
              Ghost Reviews analyzes publicly available Google reviews for signals
              of fraudulent or coordinated activity and presents the findings as
              transparent, probabilistic signals with plain-language reasoning.
              For customers, we prepare evidence and file policy-violation reports
              through Google&apos;s official reporting channels, and track the
              outcome.
            </p>
          </Section>

          <Section title="2. No guarantee of removal">
            <p className="leading-relaxed">
              We file removal requests through Google&apos;s official process —{" "}
              <strong className="text-[color:var(--foreground)]">
                we cannot and do not guarantee that Google will remove any review.
              </strong>{" "}
              All removal decisions are made by Google at its sole discretion. We
              have no special access to Google and do not imply any. What we
              provide is the analysis, the evidence, and the filing work.
            </p>
          </Section>

          <Section title="3. Our findings are signals, not verdicts">
            <p className="leading-relaxed">
              Our outputs are likelihoods and signals with reasoning — not
              definitive determinations that any review is fake. You are
              responsible for your own decisions about how to act on them.
            </p>
          </Section>

          <Section title="4. Ethical and acceptable use">
            <p className="leading-relaxed">
              We only target reviews that show genuine signals of being fraudulent
              or in violation of Google&apos;s policies. We do{" "}
              <strong className="text-[color:var(--foreground)]">not</strong> help
              suppress honest reviews, including harshly negative ones containing
              specific, verifiable details. Suppressing legitimate reviews is
              contrary to the FTC&apos;s Consumer Review Rule (16 CFR Part 465) and
              our principles. You agree not to use Ghost Reviews to suppress
              legitimate criticism, and we may decline or terminate service where
              that appears to be the goal.
            </p>
          </Section>

          <Section title="5. Billing">
            <p className="leading-relaxed">
              Paid services are billed on a success-fee basis unless otherwise
              agreed in writing: you pay the agreed amount per review that is
              actually removed, and you owe nothing for reviews that are not
              removed. Payments are processed by Stripe. For done-for-you filing,
              you authorize us in writing to act on your behalf, you represent that
              you are authorized to engage us for the business, and you may revoke
              that authorization at any time.
            </p>
          </Section>

          <Section title="6. Your responsibilities">
            <p className="leading-relaxed">
              You agree to provide accurate information, to use the service only
              for businesses you are authorized to act for, and to keep your
              account secure. You are responsible for activity under your account.
            </p>
          </Section>

          <Section title="7. Disclaimers and limitation of liability">
            <p className="leading-relaxed">
              The service is provided &quot;as is&quot; and &quot;as
              available,&quot; without warranties of any kind, to the fullest
              extent permitted by law. To the maximum extent permitted by law, our
              total liability for any claim arising from the service is limited to
              the amount you paid us for the service in the three months preceding
              the claim. We are not liable for indirect, incidental, or
              consequential damages.
            </p>
          </Section>

          <Section title="8. Termination">
            <p className="leading-relaxed">
              You may stop using the service at any time. We may suspend or
              terminate access for violation of these Terms or misuse of the
              service.
            </p>
          </Section>

          <Section title="9. Changes">
            <p className="leading-relaxed">
              We may update these Terms as the service evolves; the &quot;Last
              updated&quot; date reflects the current version. Continued use after
              changes means you accept the updated Terms.
            </p>
          </Section>

          <Section title="10. Governing law">
            <p className="leading-relaxed">
              These Terms are governed by the laws of the Province of Ontario and
              the federal laws of Canada applicable therein.
            </p>
          </Section>

          <Section title="11. Contact">
            <p className="mt-1 leading-relaxed">
              Ghost Reviews
              <br />
              Suite 1022, 1737 Richmond Street Unit #9
              <br />
              London, ON N5X 3Y2, Canada
              <br />
              <a
                href="mailto:devon@ghostreviews.app"
                className="text-[color:var(--accent)] hover:underline"
              >
                devon@ghostreviews.app
              </a>
            </p>
          </Section>
        </article>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
