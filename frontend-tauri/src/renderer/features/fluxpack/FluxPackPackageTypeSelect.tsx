import type { FluxoraFluxPackPackageType } from '../../../shared/fluxora-api';
import { CustomSelect } from '../../design-system';

const packageTypeOptions = [
  { label: 'Полная', value: 'full' },
  { label: 'Рецепт', value: 'recipe' }
] as const;

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
  return (
    <label className="fluxpack-package-type-control">
      <span>Тип упаковки</span>
      <CustomSelect
        ariaLabel="Тип упаковки FluxPack"
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
