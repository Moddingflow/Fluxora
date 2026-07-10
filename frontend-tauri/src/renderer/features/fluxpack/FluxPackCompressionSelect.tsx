import type { FluxoraFluxPackCompressionMode } from '../../../shared/fluxora-api';
import { CustomSelect } from '../../design-system';

const compressionOptions = [
  { label: 'Быстро', value: 'fast' },
  { label: 'Оптимально', value: 'optimal' },
  { label: 'Минимальный размер', value: 'smallest' }
] as const;

export interface FluxPackCompressionSelectProps {
  disabled?: boolean;
  onChange: (mode: FluxoraFluxPackCompressionMode) => void;
  value: FluxoraFluxPackCompressionMode;
}

export function FluxPackCompressionSelect({
  disabled = false,
  onChange,
  value
}: FluxPackCompressionSelectProps) {
  return (
    <label className="fluxpack-compression-control">
      <span>Сжатие</span>
      <CustomSelect
        ariaLabel="Режим сжатия FluxPack"
        className="fluxpack-compression-select"
        density="compact"
        disabled={disabled}
        menuMaxHeight={118}
        onValueChange={(nextValue) => {
          if (nextValue === 'fast' || nextValue === 'optimal' || nextValue === 'smallest') {
            onChange(nextValue);
          }
        }}
        options={compressionOptions}
        value={value}
      />
    </label>
  );
}
