import Link from "next/link";
import { Shield } from "lucide-react";
import { COMPANY_NAME, HERO_BODY } from "@/lib/public-branding";

export default function LandingFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)] text-white">
              <Shield className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">{COMPANY_NAME}</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm text-[var(--text-secondary)]">{HERO_BODY}</p>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Product</h4>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
            <li>
              <Link href="#product">Product</Link>
            </li>
            <li>
              <Link href="#templates">Templates</Link>
            </li>
            <li>
              <Link href="#safety">Safety</Link>
            </li>
            <li>
              <Link href="#pricing">Pricing</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Legal</h4>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
            <li>
              <Link href="/why-zelta">Privacy</Link>
            </li>
            <li>
              <Link href="/why-zelta">Terms</Link>
            </li>
            <li>
              <a href="mailto:hello@wave.local">Contact</a>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--text-secondary)]">
        © {new Date().getFullYear()} {COMPANY_NAME}
      </p>
    </footer>
  );
}
