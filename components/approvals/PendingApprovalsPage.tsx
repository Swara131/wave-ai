"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import {
  buildActionReviewView,
  describeActionIntent,
} from "@/lib/approvals/action-review-copy";
import ApprovalActionCard, {
  type ApprovalResolution,
} from "./ApprovalActionCard";
import ApprovalsAllClearEmptyState from "@/components/trust/empty-states/ApprovalsAllClearEmptyState";
import type { ApprovalStatus, PendingApproval } from "@/lib/approval-types";
import type { AuditTimelineEntry } from "@/lib/audit/types";
import {
  APPROVE_SUCCESS_COPY,
  REJECT_SUCCESS_COPY,
} from "@/lib/approvals/action-review-copy";
import {
  findAuthorizedProposalForDeepLink,
  parseProposalDeepLinkParam,
  shouldClearFilterForDeepLink,
  type ProposalDeepLinkFilter,
} from "@/lib/approvals/proposal-deep-link";
import { buildMonthlyProtectionSummary } from "@/lib/dashboard/trust-empty-states";
import { FLOW_ERRORS } from "@/lib/ux/flow-copy";
import { continueHrefAfterApproval } from "@/lib/approvals/continue-after-approval";

type FilterKey = ProposalDeepLinkFilter;

interface Toast {
  id: string;
  message: string;
  type: "success" | "warning" | "info";
}

async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const response = await fetch("/api/approvals");
  const payload = (await response.json()) as {
    approvals?: PendingApproval[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load approvals.");
  }

  return payload.approvals ?? [];
}

async function fetchAuditEntries(): Promise<AuditTimelineEntry[]> {
  const response = await fetch("/api/audit/timeline?limit=100");
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { entries?: AuditTimelineEntry[] };
  return payload.entries ?? [];
}

export default function PendingApprovalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkProposalId = parseProposalDeepLinkParam(searchParams.get("proposal"));
  const deepLinkAction = searchParams.get("action");

  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [resolved, setResolved] = useState<Record<string, ApprovalResolution>>({});
  const [resolvedApprovals, setResolvedApprovals] = useState<Record<string, PendingApproval>>({});
  const [auditEntries, setAuditEntries] = useState<AuditTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<Toast | null>(null);
  const [highlightedProposalId, setHighlightedProposalId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingApprovalId, setSavingApprovalId] = useState<string | null>(null);
  const [autoActionHandled, setAutoActionHandled] = useState(false);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [pending, audit] = await Promise.all([
        fetchPendingApprovals(),
        fetchAuditEntries(),
      ]);
      setApprovals(pending);
      setAuditEntries(audit);
    } catch {
      setLoadError(FLOW_ERRORS.loadApprovals);
    } finally {
      setLoading(false);
    }
  }, []);

  const monthlyProtectionSummary = useMemo(
    () => buildMonthlyProtectionSummary(auditEntries, { useDemoFallback: false }),
    [auditEntries]
  );

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => {
      void loadData();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (loading || !deepLinkProposalId) {
      return;
    }

    const match = findAuthorizedProposalForDeepLink(approvals, deepLinkProposalId);
    if (!match) {
      return;
    }

    if (shouldClearFilterForDeepLink(filter, match)) {
      // Deep links always show the targeted approval in the unfiltered list.
    }

    setHighlightedProposalId(match.id);
    setSelectedId(match.id);

    const scrollTimer = window.setTimeout(() => {
      const node =
        cardRefs.current.get(match.id) ??
        document.querySelector(`[data-proposal-id="${match.id}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);

    const clearHighlightTimer = window.setTimeout(() => {
      setHighlightedProposalId(null);
    }, 8000);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearHighlightTimer);
    };
  }, [loading, approvals, deepLinkProposalId, filter]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? approvals
        : approvals.filter((a) => a.riskSeverity === filter),
    [approvals, filter]
  );

  const showToast = (message: string, type: Toast["type"] = "success") => {
    const id = crypto.randomUUID();
    setToast({ id, message, type });
    setTimeout(() => setToast(null), 3200);
  };

  const handleAction = useCallback(
    async (id: string, action: ApprovalStatus, comment?: string) => {
      if (action === "pending") return;

      const labels: Record<ApprovalStatus, string> = {
        approved: "Approved",
        rejected: "Rejected",
        changes_requested: "Changes requested",
        escalated: "Escalated to senior reviewer",
        pending: "Pending",
      };

      setSavingApprovalId(id);

      try {
        const response = await fetch(`/api/approvals/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: action, note: comment }),
        });

        const payload = (await response.json()) as {
          error?: string;
          result?: {
            runtimeResume?: {
              resumed?: boolean;
              runId?: string | null;
              runStatus?: string;
              runSummary?: string | null;
            };
          };
        };
        if (!response.ok) {
          throw new Error(payload.error ?? FLOW_ERRORS.saveApproval);
        }

        const decidedAt = new Date().toISOString();
        const approval = approvals.find((item) => item.id === id);
        if (approval) {
          setResolvedApprovals((prev) => ({ ...prev, [id]: approval }));
        }

        const runStatus = payload.result?.runtimeResume?.runStatus;
        const runSummary = payload.result?.runtimeResume?.runSummary;

        if (action === "approved") {
          setResolved((prev) => ({
            ...prev,
            [id]: {
              status: "approved",
              decidedAt,
              executed: runStatus !== "failed",
              executionError: runStatus === "failed" ? runSummary ?? undefined : undefined,
              runStatus,
            },
          }));
        } else if (action === "rejected") {
          setResolved((prev) => ({
            ...prev,
            [id]: {
              status: "rejected",
              decidedAt,
              reason: comment ?? "Action denied",
            },
          }));
        }

        const message =
          action === "approved"
            ? APPROVE_SUCCESS_COPY
            : action === "rejected"
              ? REJECT_SUCCESS_COPY
              : labels[action];
        showToast(message, action === "approved" ? "success" : "warning");
        void loadData();

        if (action === "approved" && approval) {
          const href = continueHrefAfterApproval(approval, {
            resumed: Boolean(payload.result?.runtimeResume?.resumed && payload.result.runtimeResume.runId),
          });
          router.push(href);
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : FLOW_ERRORS.saveApproval, "warning");
      } finally {
        setSavingApprovalId(null);
      }
    },
    [approvals, loadData, router]
  );

  useEffect(() => {
    if (
      loading ||
      autoActionHandled ||
      !deepLinkProposalId ||
      (deepLinkAction !== "approve" && deepLinkAction !== "reject")
    ) {
      return;
    }

    const match = findAuthorizedProposalForDeepLink(approvals, deepLinkProposalId);
    const existingResolution = resolved[match?.id ?? ""];
    if (!match || (existingResolution && existingResolution.status !== "pending")) {
      return;
    }

    setAutoActionHandled(true);
    void handleAction(
      match.id,
      deepLinkAction === "approve" ? "approved" : "rejected",
      deepLinkAction === "reject" ? "Manual rejection" : undefined
    );
  }, [
    loading,
    autoActionHandled,
    deepLinkProposalId,
    deepLinkAction,
    approvals,
    resolved,
    handleAction,
  ]);

  const visibleApprovals = useMemo(() => {
    const pendingIds = new Set(filtered.map((a) => a.id));
    const resolvedCards = Object.entries(resolved)
      .filter(([id, state]) => state.status !== "pending" && !pendingIds.has(id))
      .map(([id, state]) => {
        const cached = resolvedApprovals[id] ?? approvals.find((a) => a.id === id);
        return cached ? { approval: cached, resolution: state } : null;
      })
      .filter((item): item is { approval: PendingApproval; resolution: ApprovalResolution } =>
        Boolean(item)
      );

    return [
      ...filtered.map((approval) => ({
        approval,
        resolution: resolved[approval.id] ?? ({ status: "pending" } as ApprovalResolution),
      })),
      ...resolvedCards,
    ];
  }, [filtered, resolved, resolvedApprovals, approvals]);

  return (
    <PageShell maxWidth="6xl" className="ap-page">
      <PageHeader
        icon={ClipboardCheck}
        title="Approvals"
        description="Review agent actions that need your approval before they run."
      />

      <section className="ds-section" aria-labelledby="pending-approvals-heading">
        <div className="ap-section-intro">
          <h2 id="pending-approvals-heading" className="ap-section-title">
            Pending actions
          </h2>
          <p className="ap-section-subtitle">
            Approve to execute the action once. Reject to block it permanently.
          </p>
        </div>

        {loadError ? (
          <ErrorState
            title="Wave couldn't load approvals."
            description="Refresh the page or check your connection, then try again."
            onFix={() => void loadData()}
            fixLabel="Try again"
            technical={loadError}
          />
        ) : null}

        {loading ? (
          <Skeleton lines={5} />
        ) : visibleApprovals.length === 0 ? (
          <ApprovalsAllClearEmptyState summary={monthlyProtectionSummary} />
        ) : (
          <div className="ap-split">
            <div className="ds-table-wrap ap-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Action</th>
                    <th>Risk</th>
                    <th>Requested</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleApprovals.map(({ approval, resolution }) => {
                    const review = buildActionReviewView(approval);
                    const status =
                      resolution.status === "approved"
                        ? "Approved"
                        : resolution.status === "rejected"
                          ? "Denied"
                          : "Pending";
                    const tone =
                      status === "Approved"
                        ? "success"
                        : status === "Denied"
                          ? "danger"
                          : "pending";
                    return (
                      <tr
                        key={approval.id}
                        className={selectedId === approval.id ? "ap-row-selected" : ""}
                        onClick={() => setSelectedId(approval.id)}
                      >
                        <td>{review.agentName}</td>
                        <td>{describeActionIntent(approval)}</td>
                        <td>{review.riskLabel}</td>
                        <td>{review.timeWaiting}</td>
                        <td>
                          <StatusBadge tone={tone}>{status}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <aside className="ap-detail">
              {visibleApprovals
                .filter(({ approval }) => approval.id === (selectedId ?? highlightedProposalId ?? visibleApprovals[0]?.approval.id))
                .slice(0, 1)
                .map(({ approval, resolution }, index) => (
                  <div
                    key={approval.id}
                    ref={(node) => {
                      cardRefs.current.set(approval.id, node);
                    }}
                  >
                    <ApprovalActionCard
                      approval={approval}
                      index={index}
                      highlighted={highlightedProposalId === approval.id}
                      resolution={resolution}
                      saving={savingApprovalId === approval.id}
                      onAction={handleAction}
                    />
                  </div>
                ))}
            </aside>
          </div>
        )}
      </section>

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : toast.type === "warning"
                ? "bg-amber-600 text-white"
                : "bg-indigo-600 text-white"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}
    </PageShell>
  );
}
