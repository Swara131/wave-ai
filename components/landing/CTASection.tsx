"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export default function CTASection() {
  return (
    <section className="landing-section">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35 }}
        className="landing-card mx-auto max-w-3xl px-8 py-12 text-center"
      >
        <h2 className="text-3xl font-semibold tracking-tight">Your next teammate can be safe by default.</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="landing-cta-primary rounded-full px-5 py-2.5 text-sm font-semibold">
            Build your first agent
          </Link>
          <Link href="/#templates" className="landing-cta-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
            View templates
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
