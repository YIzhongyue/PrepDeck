import { useMemo } from "react";
import {
  DAILY_EMAIL_MAX_QUESTIONS, DAILY_EMAIL_MIN_QUESTIONS, DAILY_EMAIL_SOURCES, type DailyEmailSource
} from "@prepdeck/shared";
import { usePrepDeck } from "../../store/PrepDeckContext";
import { RadioButton, RadioGroup } from "@/components/base/radio-buttons/radio-buttons";
import { Select } from "@/components/base/select/select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { sectionAnchor } from "./SettingsNav";
import { hourLabel, nextDeliveryLabel, type ZoneClock } from "./zoneClock";

const SOURCE_LABELS: Record<DailyEmailSource, { title: string; body: string }> = {
  wrong: { title: "Wrong book", body: "Questions you've previously answered incorrectly." },
  bm: { title: "Bookmarks", body: "Questions you've saved for later." },
  new: { title: "Unattempted", body: "Questions you haven't tried yet." }
};

const QUESTION_COUNTS = Array.from(
  { length: DAILY_EMAIL_MAX_QUESTIONS - DAILY_EMAIL_MIN_QUESTIONS + 1 },
  (_, i) => DAILY_EMAIL_MIN_QUESTIONS + i
);

// implementation — the daily review email settings read and write
// state.emailSettings directly (no controlled draft): every control here is a
// discrete picker, applied on change with no separate Save step.
export default function DailyEmailCard({ clock }: { clock: ZoneClock | null }) {
  const { state, updateEmailSettings } = usePrepDeck();
  const emailSettings = state.emailSettings;
  const enabled = !!emailSettings?.enabled;
  const deliveryHourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: hourLabel(h) })),
    []
  );

  return (
    <div {...sectionAnchor("email")} className="settings-card settings-card-clip">
      <div className="settings-row settings-row-inline">
        <div className="settings-row-text settings-row-text-grow">
          <h3 id="settings-email-title" className="settings-row-title">Daily review email</h3>
          <p id="settings-email-desc" className="settings-row-desc">A few practice questions in your inbox — no answers included.</p>
        </div>
        {enabled && clock && (
          <span className="settings-status-pill">Next: {nextDeliveryLabel(emailSettings.sendHourLocal, clock)}</span>
        )}
        <Toggle
          size="md"
          aria-labelledby="settings-email-title"
          aria-describedby="settings-email-desc"
          isSelected={enabled}
          onChange={(enabling) => updateEmailSettings({ enabled: enabling })}
        />
      </div>

      {emailSettings?.enabled && (
        <div className="settings-email-body">
          <div className="settings-email-fields">
            <div className="settings-email-field">
              <p id="settings-email-count" className="settings-field-label">Questions per email</p>
              <div role="group" aria-labelledby="settings-email-count" className="settings-seg">
                {QUESTION_COUNTS.map((n) => (
                  <button
                    key={n} type="button"
                    aria-pressed={emailSettings.questionsPerEmail === n}
                    onClick={() => updateEmailSettings({ questionsPerEmail: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-email-field settings-email-time">
              <p id="settings-email-time" className="settings-field-label">Delivery time</p>
              <Select
                aria-labelledby="settings-email-time"
                hint={`In your time zone, ${emailSettings.timezone}.`}
                selectedKey={String(emailSettings.sendHourLocal)}
                onSelectionChange={(key) => updateEmailSettings({ sendHourLocal: Number(key) })}
                items={deliveryHourOptions}
              >
                {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
              </Select>
            </div>
          </div>

          <div className="settings-email-field">
            <p id="settings-email-source" className="settings-field-label">Question source</p>
            <RadioGroup
              aria-labelledby="settings-email-source"
              size="sm"
              value={emailSettings.source}
              onChange={(value) => updateEmailSettings({ source: value as DailyEmailSource })}
              className="settings-sources"
            >
              {DAILY_EMAIL_SOURCES.map((source) => (
                <RadioButton
                  key={source}
                  value={source}
                  size="sm"
                  label={SOURCE_LABELS[source].title}
                  hint={SOURCE_LABELS[source].body}
                  className={cx(
                    "rounded-[20px] px-4 py-3.5 ring-inset",
                    emailSettings.source === source ? "bg-brand-primary ring-[1.5px] ring-brand" : "bg-primary ring-1 ring-primary"
                  )}
                />
              ))}
            </RadioGroup>
          </div>
        </div>
      )}
    </div>
  );
}
