import { useEffect, useState } from 'react';
import type { PidStudyDraft } from '../../lib/sim/dymola-pid-study-input';

type PidStudyEditorProps = {
  value: PidStudyDraft;
  onChange: (next: PidStudyDraft) => void;
  onValidityChange?: (valid: boolean) => void;
};

type NumericField = keyof PidStudyDraft;

type FieldConfig = {
  key: NumericField;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  integer?: boolean;
};

const fields: FieldConfig[] = [
  { key: 'processGain', label: 'Process gain', min: 0.1, max: 10, step: 0.1, unit: 'dimensionless' },
  { key: 'timeConstant', label: 'Time constant', min: 0.05, max: 100, step: 0.05, unit: 's' },
  { key: 'proportionalGain', label: 'Proportional gain', min: 0, max: 20, step: 0.1, unit: 'dimensionless' },
  { key: 'integralGain', label: 'Integral gain', min: 0, max: 20, step: 0.1, unit: '1/s' },
  { key: 'setpoint', label: 'Setpoint', min: 0.1, max: 100, step: 0.1, unit: 'process units' },
  { key: 'duration', label: 'Duration', min: 0.1, max: 500, step: 0.1, unit: 's' },
  { key: 'points', label: 'Points', min: 2, max: 256, step: 1, unit: 'samples', integer: true },
];

function draftValues(value: PidStudyDraft): Record<NumericField, string> {
  return Object.fromEntries(fields.map(({ key }) => [key, String(value[key])])) as Record<NumericField, string>;
}

function isFieldValueValid(field: FieldConfig, raw: string): boolean {
  if (raw.trim() === '') return false;
  const numericValue = Number(raw);
  return (
    Number.isFinite(numericValue) &&
    numericValue >= field.min &&
    numericValue <= field.max &&
    (!field.integer || Number.isInteger(numericValue))
  );
}

export function PidStudyEditor({ value, onChange, onValidityChange }: PidStudyEditorProps) {
  const [textValues, setTextValues] = useState(() => draftValues(value));

  useEffect(() => {
    setTextValues(draftValues(value));
  }, [value]);

  useEffect(() => {
    onValidityChange?.(fields.every((field) => isFieldValueValid(field, textValues[field.key])));
  }, [onValidityChange, textValues]);

  function updateField(field: FieldConfig, raw: string) {
    setTextValues((current) => ({ ...current, [field.key]: raw }));
    if (raw.trim() === '') return;

    if (!isFieldValueValid(field, raw)) return;

    onChange({ ...value, [field.key]: Number(raw) });
  }

  return (
    <section aria-labelledby="pid-study-editor-title">
      <h2 id="pid-study-editor-title">PI control study</h2>
      <p>
        First-order plant controlled by a PI controller. Results use host f64
        arithmetic.
      </p>
      <div>
        {fields.map((field) => (
          <label key={field.key}>
            {field.label} ({field.unit})
            <input
              type="number"
              data-testid={`pid-study-${field.key}`}
              name={field.key}
              min={field.min}
              max={field.max}
              step={field.step}
              value={textValues[field.key]}
              onChange={(event) => updateField(field, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
