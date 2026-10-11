"use client";

import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";

interface BuilderClarifyPanelProps {
  result: AgentRequirementsResult;
  onAnswer: (requirement: AgentRequirement, value: string) => void;
  onContinue: () => void;
  continuing?: boolean;
}

const ASK_TYPES = new Set(["choice", "email", "phone", "schedule"]);

export default function BuilderClarifyPanel({
  result,
  onAnswer,
  onContinue,
  continuing,
}: BuilderClarifyPanelProps) {
  const questions = result.requirements.filter(
    (item) => item.required && item.status === "missing" && ASK_TYPES.has(item.configurationType)
  );

  return (
    <section className="wfb-clarify" aria-labelledby="wfb-clarify-heading">
      <h2 id="wfb-clarify-heading">A few questions before we create this agent</h2>
      <p>
        Wave understood what this agent should do. Answer only what this workflow needs — nothing
        extra.
      </p>
      <ol className="wfb-clarify-list">
        {questions.map((item) => (
          <li key={item.key} className="wfb-clarify-item">
            <strong>{item.label}</strong>
            <span>{item.reason}</span>
            {item.configurationType === "choice" && item.options ? (
              <div className="wfb-clarify-choices">
                {item.options.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    className="wfb-clarify-choice"
                    aria-pressed={item.value === choice.id}
                    onClick={() => onAnswer(item, choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : null}
            {item.configurationType === "email" ? (
              <form
                className="wfb-clarify-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = String(new FormData(event.currentTarget).get("email") ?? "");
                  if (value.includes("@")) onAnswer(item, value);
                }}
              >
                <input className="ds-input" name="email" type="email" placeholder="you@example.com" required />
                <button type="submit" className="wfb-btn wfb-btn-secondary">
                  Save
                </button>
              </form>
            ) : null}
            {item.configurationType === "phone" ? (
              <form
                className="wfb-clarify-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = String(new FormData(event.currentTarget).get("phone") ?? "");
                  if (value.trim()) onAnswer(item, value.trim());
                }}
              >
                <input className="ds-input" name="phone" type="tel" placeholder="+91…" required />
                <button type="submit" className="wfb-btn wfb-btn-secondary">
                  Save
                </button>
              </form>
            ) : null}
            {item.configurationType === "schedule" ? (
              <form
                className="wfb-clarify-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  onAnswer(
                    item,
                    JSON.stringify({
                      when: String(data.get("when") ?? "daily"),
                      time: String(data.get("time") ?? "09:00"),
                      timezone: String(data.get("timezone") ?? "Asia/Kolkata"),
                    })
                  );
                }}
              >
                <select className="ds-input" name="when" defaultValue="daily">
                  <option value="daily">Every morning / daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="at_time">At a specific time</option>
                </select>
                <input className="ds-input" name="time" type="time" defaultValue="09:00" />
                <input className="ds-input" name="timezone" defaultValue="Asia/Kolkata" aria-label="Timezone" />
                <button type="submit" className="wfb-btn wfb-btn-secondary">
                  Save schedule
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="wfb-btn wfb-btn-primary"
        disabled={continuing || questions.length > 0}
        onClick={onContinue}
      >
        {continuing ? "Creating agent…" : questions.length > 0 ? "Answer the questions to continue" : "Create this agent"}
      </button>
    </section>
  );
}
