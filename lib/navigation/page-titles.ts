export function getPageTitle(pathname: string): string {
  if (pathname === "/dashboard" || pathname === "/") return "Home";
  if (pathname.startsWith("/agents/platform")) return "Agents";
  if (pathname.startsWith("/agents/create")) return "Agent Builder";
  if (pathname.startsWith("/agents/") && pathname.includes("/edit")) return "Edit agent";
  if (pathname.startsWith("/agents/") && pathname.includes("/verify")) return "Verify agent";
  if (pathname.startsWith("/agents/") && pathname.includes("/deploy")) return "Deploy agent";
  if (
    pathname.startsWith("/dashboard/templates") ||
    pathname.startsWith("/agents/templates") ||
    pathname === "/templates" ||
    pathname.startsWith("/templates/")
  ) {
    return "Templates";
  }
  if (pathname.startsWith("/decision-agents/create")) return "Multiple Decision Agents";
  if (pathname.startsWith("/decision-agents/templates")) return "Multiple Decision Agents";
  if (pathname.startsWith("/decision-agents/") && pathname.includes("/test")) return "Test decision agent";
  if (pathname.startsWith("/decision-agents/results")) return "Research report";
  if (pathname.startsWith("/decision-agents")) return "Multiple Decision Agents";
  if (pathname.startsWith("/monitor")) return "Monitor";
  if (pathname.startsWith("/integrations")) return "My Agents";
  if (pathname.startsWith("/approvals")) return "Approvals";
  if (pathname.startsWith("/safety") || pathname.startsWith("/risk")) return "Safety";
  if (pathname.startsWith("/billing")) return "Pricing";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/agents/") && pathname.includes("/ready")) return "Agent ready";
  if (pathname.startsWith("/agents/") && pathname.includes("/workflow")) return "Agent workflow";
  if (pathname.startsWith("/agents/") && pathname.includes("/setup")) return "Agent setup";
  if (pathname.startsWith("/agents/") && pathname.includes("/lighting")) return "Lighting Concierge";
  if (pathname.startsWith("/agents/") && pathname.includes("/travel")) return "Travel Companion";
  if (pathname.startsWith("/agents/") && pathname.includes("/wedding")) return "Wedding & Celebration Planner";
  if (pathname.startsWith("/agents/") && pathname.includes("/group")) return "Group Decision Planner";
  if (pathname.startsWith("/agents/") && pathname.includes("/run")) return "Run agent";
  if (pathname.startsWith("/agents/") && pathname.includes("/result")) return "Summary";
  if (pathname.startsWith("/agents/") && pathname.includes("/test")) return "Test agent";
  if (pathname.startsWith("/agents/") && pathname.includes("/safety")) return "Safety Autopilot";
  if (pathname.startsWith("/dashboard/agents/") && pathname.includes("/safety")) return "Safety Autopilot";
  if (pathname.startsWith("/agents/")) return "Agent";
  if (pathname.startsWith("/audit")) return "Activity";
  if (pathname.startsWith("/analytics")) return "Insights";
  if (pathname.startsWith("/why-zelta")) return "Why Wave";
  if (pathname.startsWith("/developers")) return "Developers";
  if (pathname.startsWith("/notifications")) return "Alerts";
  return "Wave";
}
