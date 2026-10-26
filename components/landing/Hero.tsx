"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { COMPANY_NAME, HERO_BODY } from "@/lib/public-branding";
import HeroWorkflowPreview from "./HeroWorkflowPreview";

export default function Hero() {
  return (
    <section className="landing-section px-4 pb-16 pt-28 sm:px-6 sm:pt-32" id="product">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="landing-kicker"
          >
            {COMPANY_NAME}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="mt-3 max-w-xl text-4xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-5xl"
          >
            Build AI agents you can actually trust.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]"
          >
            {HERO_BODY}
          </motion.p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="landing-cta-primary rounded-full px-5 py-2.5 text-sm font-semibold">
              Build an agent free
            </Link>
            <Link href="#templates" className="landing-cta-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
              Explore templates
            </Link>
          </div>
        </div>
        <HeroWorkflowPreview />
      </div>
    </section>
  );
}
