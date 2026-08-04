import type { FluxoraFluxPackPackageType } from '../../../shared/fluxora-api';
import { CustomSelect } from '../../design-system';
import { useLocalization } from '../../../localization/react';

export interface FluxPackPackageTypeSelectProps {
  disabled?: boolean;
  onChange: (type: FluxoraFluxPackPackageType) => void;
  value: FluxoraFluxPackPackageType;
}

export function FluxPackPackageTypeSelect({
  disabled = false,
  onChange,
  value
}: FluxPackPackageTypeSelectProps) {
  const { t } = useLocalization();
  const packageTypeOptions = [
    { label: t('fluxpack.type.full'), value: 'full' },
    { label: t('fluxpack.type.recipe'), value: 'recipe' }
  ] as const;
  return (
    <label className="fluxpack-package-type-control">
      <span>{t('fluxpack.type.label')}</span>
      <CustomSelect
        ariaLabel={t('fluxpack.type.aria')}
        className="fluxpack-package-type-select"
        density="compact"
        disabled={disabled}
        menuMaxHeight={96}
        onValueChange={(nextValue) => {
          if (nextValue === 'full' || nextValue === 'recipe') {
            onChange(nextValue);
          }
        }}
        options={packageTypeOptions}
        value={value}
      />
    </label>
  );
}
