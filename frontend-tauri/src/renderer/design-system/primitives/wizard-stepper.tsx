import { Icon } from '../icons';
import { cx } from './utils';

export type WizardStepState = 'complete' | 'pending';

export interface WizardStep {
  disabled?: boolean;
  hint?: string;
  id: string;
  label: string;
  state: WizardStepState;
}

export interface WizardStepperProps {
  activeStepId: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onStepSelect?: (stepId: string) => void;
  steps: WizardStep[];
}

export function WizardStepper({
  activeStepId,
  ariaLabel,
  className,
  disabled = false,
  onStepSelect,
  steps
}: WizardStepperProps) {
  return (
    <nav aria-label={ariaLabel} className={cx('flx-wizard-steps', className)}>
      <ol className="flx-wizard-steps__list">
        {steps.map((step, index) => {
          const active = step.id === activeStepId;
          const stepDisabled = disabled || step.disabled || !onStepSelect;

          return (
            <li className="flx-wizard-steps__item" key={step.id}>
              <button
                aria-current={active ? 'step' : undefined}
                className="flx-wizard-step"
                data-state={step.state}
                disabled={stepDisabled}
                onClick={() => onStepSelect?.(step.id)}
                type="button"
              >
                <span aria-hidden="true" className="flx-wizard-step__marker">
                  {step.state === 'complete' ? (
                    <Icon name="check" size={14} strokeWidth={2.2} />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </span>
                <span className="flx-wizard-step__copy">
                  <span className="flx-wizard-step__label">{step.label}</span>
                  {step.hint ? <span className="flx-wizard-step__hint">{step.hint}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
