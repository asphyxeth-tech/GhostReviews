import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = {
  title: "Privacy Policy — Ghost Reviews",
  description:
    "How Ghost Reviews collects, uses, discloses, and protects information.",
};

export const dynamic = "force-static";

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Last updated: June 23, 2026
          </p>

          <p className="mt-6 leading-relaxed">
            Ghost Reviews (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) is a
            service that helps local businesses detect signals of fraudulent or
            coordinated reviews on their public Google Business Profile and, for
            customers, file policy-violation reports through Google&apos;s
            official channels. This policy explains what information we collect,
            how we use it, who we share it with, and how we protect it. We
            operate from Ontario, Canada.
          </p>

          <Section title="1. Information we collect">
            <p className="leading-relaxed">We collect:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong className="text-[color:var(--foreground)]">
                  Information you provide.
                </strong>{" "}
                Your email address when you create an account (we use
                passwordless &quot;magic link&quot; sign-in); the Google Business
                Profile links or business names you submit to be scanned; and any
                messages you send us.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">
                  Technical information collected automatically.
                </strong>{" "}
                A limited amount of request metadata, including your IP address,
                which we use for security and to rate-limit abuse of our public
                scanner, plus standard server logs.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">
                  Public business review data.
                </strong>{" "}
                When a scan runs, we retrieve publicly available Google review
                information about the business being analyzed. This is public
                business data used to perform the analysis.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">
                  Payment information.
                </strong>{" "}
                For paying customers, payments are processed by Stripe. We never
                see or store your full card number; Stripe handles card data
                directly.
              </li>
            </ul>
          </Section>

          <Section title="2. How we use information">
            <ul className="list-disc space-y-2 pl-6">
              <li>To provide and operate the scanning and analysis service.</li>
              <li>To authenticate you and save your scan history to your account.</li>
              <li>
                To protect the service — detecting and preventing abuse, fraud,
                and excessive automated use.
              </li>
              <li>To communicate with you about your account, results, and support.</li>
              <li>To bill customers for services rendered (via Stripe).</li>
            </ul>
          </Section>

          <Section title="3. How we share and disclose information">
            <p className="leading-relaxed">
              <strong className="text-[color:var(--foreground)]">
                We do not sell your personal information.
              </strong>{" "}
              We share information with the following service providers
              (subprocessors), each only to the extent needed to deliver the
              service, through secure API integrations:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong className="text-[color:var(--foreground)]">Anthropic</strong>{" "}
                — AI analysis of review content.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">
                  Outscraper / Nimble
                </strong>{" "}
                — retrieving publicly available Google review data.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">Google</strong>{" "}
                — we access publicly available business and review data.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">Supabase</strong>{" "}
                — database and authentication.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">Vercel</strong>{" "}
                — website hosting and infrastructure.
              </li>
              <li>
                <strong className="text-[color:var(--foreground)]">Stripe</strong>{" "}
                — payment processing.
              </li>
            </ul>
            <p className="mt-3 leading-relaxed">
              We may also disclose information if required by law, to enforce our
              terms, or to protect the rights, property, or safety of our users
              or others.
            </p>
          </Section>

          <Section title="4. How we protect information">
            <p className="leading-relaxed">
              We safeguard information with industry-standard measures: encrypted
              transmission (HTTPS/TLS), access controls and row-level security on
              stored data, secrets kept in protected server-side configuration
              (never exposed to your browser), and restricting access to
              authorized purposes only. No method of transmission or storage is
              100% secure, but we work to protect your information using
              reasonable safeguards.
            </p>
          </Section>

          <Section title="5. Data retention">
            <p className="leading-relaxed">
              We retain account information and saved scans while your account is
              active. You may request deletion of your account and associated data
              at any time by contacting us, and we will delete it except where we
              are required to retain it by law.
            </p>
          </Section>

          <Section title="6. Your choices and rights">
            <p className="leading-relaxed">
              You may request access to, correction of, or deletion of your
              personal information, and you can unsubscribe from non-essential
              emails at any time (every outreach email also includes an opt-out).
              To exercise these rights, contact us using the details below.
            </p>
          </Section>

          <Section title="7. Cookies">
            <p className="leading-relaxed">
              We use essential cookies only — primarily to keep you signed in
              (authentication sessions). We do not use third-party advertising
              cookies.
            </p>
          </Section>

          <Section title="8. Children">
            <p className="leading-relaxed">
              Ghost Reviews is a business service and is not directed to children.
              We do not knowingly collect information from anyone under 16.
            </p>
          </Section>

          <Section title="9. Jurisdiction">
            <p className="leading-relaxed">
              We operate from Ontario, Canada, and handle personal information in
              accordance with Canada&apos;s Personal Information Protection and
              Electronic Documents Act (PIPEDA). If you access the service from
              elsewhere, your information may be processed in Canada and the
              United States by the providers listed above.
            </p>
          </Section>

          <Section title="10. Changes to this policy">
            <p className="leading-relaxed">
              We may update this policy as the service evolves. When we do, we will
              revise the &quot;Last updated&quot; date above. Material changes will
              be communicated where appropriate.
            </p>
          </Section>

          <Section title="11. Contact us">
            <p className="leading-relaxed">
              Questions about this policy or your information? Contact:
            </p>
            <p className="mt-3 leading-relaxed">
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
