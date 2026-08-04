import type { InstallerLanguage, SetupStep } from '../contracts';
import { translate } from '../i18n';
import { setupStepOrder, type SetupFlowState } from './setup-flow';

export interface SetupStepNavigationProps {
  currentStep: SetupStep;
  furthestStep: SetupFlowState['furthestStep'];
  language: InstallerLanguage;
  navigationLocked: boolean;
  onNavigate: (step: SetupStep) => void;
}

export function SetupStepNavigation({
  currentStep,
  furthestStep,
  language,
  navigationLocked,
  onNavigate
}: SetupStepNavigationProps) {
  const activeStepIndex = setupStepOrder.indexOf(currentStep);
  const furthestStepIndex = setupStepOrder.indexOf(furthestStep);
  const completionBoundary = Math.max(activeStepIndex, furthestStepIndex);

  return (
    <ol aria-label={translate(language, 'setup.steps.aria')} className="setup-steps">
      {setupStepOrder.map((step, index) => {
        const current = currentStep === step;
        const complete = !current && index < completionBoundary;
        const navigable = !navigationLocked && !current && index < furthestStepIndex;
        const label = translate(language, `setup.step.${step}`);
        const content = (
          <>
            <span aria-hidden="true" className="setup-step-index">{index + 1}</span>
            <span className="setup-step-label">{label}</span>
          </>
        );

        return (
          <li
            aria-current={current ? 'step' : undefined}
            data-complete={complete || undefined}
            data-current={current || undefined}
            key={step}
          >
            {navigable ? (
              <button
                aria-label={label}
                className="setup-step-row setup-step-button"
                onClick={() => onNavigate(step)}
                type="button"
              >
                {content}
              </button>
            ) : (
              <div className="setup-step-row">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
