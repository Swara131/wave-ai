import LandingNavbar from "./LandingNavbar";
import Hero from "./Hero";
import TrustStrip from "./TrustStrip";
import HowItWorks from "./HowItWorks";
import LandingWorkflowShowcase from "./LandingWorkflowShowcase";
import LandingTemplateShowcase from "./LandingTemplateShowcase";
import LandingSafetySection from "./LandingSafetySection";
import LandingPricing from "./LandingPricing";
import CTASection from "./CTASection";
import LandingFooter from "./LandingFooter";

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen">
      <LandingNavbar />
      <main id="main-content">
        <Hero />
        <TrustStrip />
        <LandingTemplateShowcase />
        <HowItWorks />
        <LandingWorkflowShowcase />
        <LandingSafetySection />
        <div id="pricing">
          <LandingPricing />
        </div>
        <CTASection />
      </main>
      <LandingFooter />
    </div>
  );
}
