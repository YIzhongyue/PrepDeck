// A calendar-date field that is always rendered in English.
//
// `<input type="date">` takes its segment placeholders ("年/月/日") and its
// drop-down calendar from the *browser's* UI language. That is not something
// the page can influence — `<html lang="en">` does not reach it — so a Chrome
// running in Chinese put Chinese into this otherwise English-only app.
//
// React Aria renders the segments and the calendar itself, so pinning the
// locale with `I18nProvider` keeps the field identical on every machine. The
// wire format stays the app's own "YYYY-MM-DD" string (or "" for unset) so
// callers do not have to know about `@internationalized/date`.

import type { ReactNode } from "react";
import { getLocalTimeZone, isSameDay, parseDate, today } from "@internationalized/date";
import type { CalendarDate } from "@internationalized/date";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X as XIcon } from "@untitledui/icons";
import {
    Button as AriaButton,
    Calendar as AriaCalendar,
    CalendarCell as AriaCalendarCell,
    CalendarGrid as AriaCalendarGrid,
    CalendarGridBody as AriaCalendarGridBody,
    CalendarGridHeader as AriaCalendarGridHeader,
    CalendarHeaderCell as AriaCalendarHeaderCell,
    DateInput as AriaDateInput,
    DatePicker as AriaDatePicker,
    DateSegment as AriaDateSegment,
    Dialog as AriaDialog,
    Group as AriaGroup,
    Heading as AriaHeading,
    I18nProvider,
    Popover as AriaPopover,
} from "react-aria-components";
import { HintText } from "@/components/base/input/hint-text";
import { Label } from "@/components/base/input/label";
import { cx } from "@/utils/cx";

/** "YYYY-MM-DD" in, `CalendarDate` out; anything unparseable reads as unset. */
const parse = (value: string): CalendarDate | null => {
    if (!value.trim()) return null;
    try {
        return parseDate(value.trim());
    } catch {
        return null;
    }
};

export interface DateFieldProps {
    /** Label text for the field. */
    label?: string;
    /** Helper text displayed below the field. */
    hint?: ReactNode;
    /** The selected date as "YYYY-MM-DD", or "" when nothing is selected. */
    value: string;
    /** Called with "YYYY-MM-DD", or "" when the field is cleared. */
    onChange: (value: string) => void;
    /** Whether the field is invalid. */
    isInvalid?: boolean;
    /** Whether the field is disabled. */
    isDisabled?: boolean;
}

export const DateField = ({ label, hint, value, onChange, isInvalid, isDisabled }: DateFieldProps) => (
    <I18nProvider locale="en-US">
        <AriaDatePicker
            aria-label={label ? undefined : "Date"}
            value={parse(value)}
            onChange={(next) => onChange(next ? next.toString() : "")}
            isInvalid={isInvalid}
            isDisabled={isDisabled}
            shouldForceLeadingZeros
            className="group flex h-max w-full flex-col items-start justify-start gap-1.5"
        >
            {label && <Label isInvalid={isInvalid}>{label}</Label>}

            <AriaGroup
                className={({ isFocusWithin, isDisabled, isInvalid }) =>
                    cx(
                        "relative flex w-full flex-row place-items-center rounded-lg bg-primary pr-1.5 shadow-xs ring-1 ring-primary transition-shadow duration-100 ease-linear ring-inset",
                        isFocusWithin && !isDisabled && "ring-2 ring-brand",
                        isDisabled && "cursor-not-allowed opacity-50",
                        isInvalid && "ring-error_subtle",
                        isInvalid && isFocusWithin && "ring-2 ring-error",
                    )
                }
            >
                <AriaDateInput className="flex min-w-0 flex-1 items-center px-3 py-2 text-md">
                    {(segment) => (
                        <AriaDateSegment
                            segment={segment}
                            className={({ isPlaceholder, isFocused, type }) =>
                                cx(
                                    "rounded px-0.5 text-primary outline-hidden",
                                    type !== "literal" && "tabular-nums",
                                    (isPlaceholder || type === "literal") && "text-placeholder",
                                    isFocused && "bg-brand-solid text-white",
                                )
                            }
                        />
                    )}
                </AriaDateInput>

                {value && !isDisabled && (
                    <AriaButton
                        // Deliberately not one of the DatePicker's own slots: clearing by
                        // deleting every segment is not discoverable, and this field is
                        // documented as optional.
                        slot={null}
                        aria-label="Clear date"
                        onPress={() => onChange("")}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-fg-quaternary outline-hidden transition duration-100 ease-linear hover:text-fg-quaternary_hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        <XIcon className="size-4 stroke-[2.25px]" />
                    </AriaButton>
                )}

                <AriaButton
                    aria-label="Choose date"
                    className="flex cursor-pointer items-center justify-center rounded p-1 text-fg-quaternary outline-hidden transition duration-100 ease-linear hover:text-fg-quaternary_hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                    <CalendarIcon className="size-5" />
                </AriaButton>
            </AriaGroup>

            {hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}

            <AriaPopover
                placement="bottom start"
                offset={4}
                className={({ isEntering, isExiting }) =>
                    cx(
                        "rounded-lg bg-primary p-3 shadow-lg ring-1 ring-secondary_alt outline-hidden",
                        isEntering && "duration-150 ease-out animate-in fade-in",
                        isExiting && "duration-100 ease-in animate-out fade-out",
                    )
                }
            >
                <AriaDialog className="outline-hidden">
                    <AriaCalendar className="w-max">
                        <header className="mb-2 flex items-center justify-between gap-2">
                            <AriaButton
                                slot="previous"
                                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-quaternary outline-hidden hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                                <ChevronLeft className="size-4 stroke-[2.25px]" />
                            </AriaButton>
                            {/* `Heading` renders an `<h2>`, and the app's global heading
                                rules (display face, 24px) are unlayered, so they beat any
                                Tailwind utility. Inline styles are what actually win here. */}
                            <AriaHeading
                                className="text-primary"
                                style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, letterSpacing: "normal", textTransform: "none" }}
                            />
                            <AriaButton
                                slot="next"
                                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-quaternary outline-hidden hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                                <ChevronRight className="size-4 stroke-[2.25px]" />
                            </AriaButton>
                        </header>

                        <AriaCalendarGrid weekdayStyle="short" className="border-collapse">
                            <AriaCalendarGridHeader>
                                {(day) => (
                                    <AriaCalendarHeaderCell className="pb-1 text-xs font-medium text-tertiary">{day}</AriaCalendarHeaderCell>
                                )}
                            </AriaCalendarGridHeader>
                            <AriaCalendarGridBody>
                                {(date) => (
                                    <AriaCalendarCell
                                        date={date}
                                        className={({ isSelected, isDisabled, isOutsideMonth, isHovered, isFocusVisible }) =>
                                            cx(
                                                "flex size-9 cursor-pointer items-center justify-center rounded-md text-sm text-primary tabular-nums outline-hidden",
                                                isOutsideMonth && "invisible",
                                                isHovered && !isSelected && "bg-primary_hover",
                                                !isSelected && isSameDay(date, today(getLocalTimeZone())) && "font-semibold text-brand-secondary",
                                                isSelected && "bg-brand-solid font-semibold text-white",
                                                isDisabled && "cursor-not-allowed text-placeholder",
                                                isFocusVisible && "ring-2 ring-focus-ring",
                                            )
                                        }
                                    />
                                )}
                            </AriaCalendarGridBody>
                        </AriaCalendarGrid>
                    </AriaCalendar>
                </AriaDialog>
            </AriaPopover>
        </AriaDatePicker>
    </I18nProvider>
);

DateField.displayName = "DateField";
