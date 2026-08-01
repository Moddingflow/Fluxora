import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type {
  FluxoraApi,
  FluxoraModdingFlowActivation
} from '../../../shared/fluxora-api';
import { createRendererOperationId } from '../../services/renderer-operation-service';
import type {
  ModdingFlowActivationConfirmationSnapshot,
  ModdingFlowActivationInstanceChoice
} from './moddingflow-activation-confirmation-store';
import { createModdingFlowActivationConfirmationStore } from './moddingflow-activation-confirmation-store';

interface ModdingFlowActivationConfirmationDialogProps {
  snapshot: ModdingFlowActivationConfirmationSnapshot;
  instances: readonly ModdingFlowActivationInstanceChoice[];
  accountConnectBusy?: boolean;
  accountConnectError?: string | null;
  onAccept: () => void;
  onConnectAccount?: () => void;
  onPreviewPlan: () => void;
  onDismiss: () => void;
  onSelectInstance: (instanceId: string) => void;
  onSelectProfile: (profileName: string) => void;
}

const fileSizeLabel = (sizeBytes: number | null): string => {
  if (sizeBytes === null) {
    return 'Размер неизвестен';
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  if (sizeBytes >= 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ModdingFlowActivationConfirmationDialog = ({
  snapshot,
  instances,
  accountConnectBusy = false,
  accountConnectError = null,
  onAccept,
  onConnectAccount,
  onPreviewPlan,
  onDismiss,
  onSelectInstance,
  onSelectProfile
}: ModdingFlowActivationConfirmationDialogProps) => {
  if (snapshot.state === 'loading' || snapshot.state === 'idle') {
    return (
      <div className="moddingflow-activation-backdrop">
        <section
          className="moddingflow-activation-dialog"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-labelledby="moddingflow-activation-title"
        >
          <header className="moddingflow-activation-dialog__header">
            <h2 id="moddingflow-activation-title">Загрузка из ModdingFlow</h2>
          </header>
          <div
            className="moddingflow-activation-dialog__skeleton"
            aria-label="Проверяем файл ModdingFlow"
          >
            <span className="flx-skeleton" />
            <span className="flx-skeleton" />
            <span className="flx-skeleton" />
          </div>
          <footer className="moddingflow-activation-dialog__actions">
            <button className="secondary-button" type="button" onClick={onDismiss}>
              Отклонить
            </button>
          </footer>
        </section>
      </div>
    );
  }

  if (snapshot.state !== 'available') {
    const stateCopy: Record<Exclude<typeof snapshot.state, 'idle' | 'loading' | 'available'>, {
      title: string;
      detail: string;
    }> = {
      unknown: {
        title: 'Файл не найден',
        detail: 'ModdingFlow не распознал этот файл.'
      },
      deleted: {
        title: 'Файл удалён',
        detail: 'Этот файл больше не опубликован в ModdingFlow.'
      },
      ineligible: {
        title: 'Файл недоступен для Fluxora',
        detail: 'Этот файл нельзя передать в менеджер.'
      },
      disconnected: {
        title: 'Подключите ModdingFlow',
        detail: 'Для этого файла нужна подключённая учётная запись.'
      },
      unsupportedGame: {
        title: 'Игра пока не поддерживается',
        detail: 'Fluxora не может выбрать совместимую сборку для этой игры.'
      },
      unavailable: {
        title: 'ModdingFlow сейчас недоступен',
        detail: 'Попробуйте открыть ссылку позже.'
      }
    };
    const copy = stateCopy[snapshot.state];
    return (
      <div className="moddingflow-activation-backdrop">
        <section
          className="moddingflow-activation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="moddingflow-activation-state-title"
        >
          <header className="moddingflow-activation-dialog__header">
            <h2 id="moddingflow-activation-state-title">{copy.title}</h2>
          </header>
          <p className="moddingflow-activation-dialog__state-copy">{copy.detail}</p>
          {accountConnectError ? <p role="alert">{accountConnectError}</p> : null}
          {snapshot.errorMessage ? <p role="alert">{snapshot.errorMessage}</p> : null}
          <footer className="moddingflow-activation-dialog__actions">
            <button
              className="secondary-button"
              type="button"
              disabled={snapshot.busyAction !== null}
              onClick={onDismiss}
            >
              {snapshot.busyAction === 'dismissing' ? 'Закрываем…' : 'Отклонить'}
            </button>
            {snapshot.state === 'disconnected' && onConnectAccount ? (
              <button
                className="primary-button"
                type="button"
                disabled={accountConnectBusy || snapshot.busyAction !== null}
                onClick={onConnectAccount}
              >
                {accountConnectBusy ? 'Подключаем…' : 'Подключить ModdingFlow'}
              </button>
            ) : null}
          </footer>
        </section>
      </div>
    );
  }

  const metadata = snapshot.preview?.metadata;
  if (!metadata || snapshot.preview?.eligible !== true) {
    return null;
  }
  const compatibleInstances = instances.filter(
    (instance) => instance.gameIds.includes(metadata.game.id)
  );
  if (compatibleInstances.length === 0) {
    return (
      <div className="moddingflow-activation-backdrop">
        <section
          className="moddingflow-activation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="moddingflow-activation-no-instance-title"
        >
          <header className="moddingflow-activation-dialog__header">
            <h2 id="moddingflow-activation-no-instance-title">Нет совместимой сборки</h2>
          </header>
          <p className="moddingflow-activation-dialog__state-copy">
            Создайте или откройте сборку для {metadata.game.name}, затем повторите запрос.
          </p>
          <footer className="moddingflow-activation-dialog__actions">
            <button className="secondary-button" type="button" onClick={onDismiss}>
              Отклонить
            </button>
          </footer>
        </section>
      </div>
    );
  }
  const selectedInstance = compatibleInstances.find(
    (instance) => instance.instanceId === snapshot.selectedInstanceId
  );

  return (
    <div className="moddingflow-activation-backdrop">
      <section
        className="moddingflow-activation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="moddingflow-activation-title"
      >
        <header className="moddingflow-activation-dialog__header">
          <h2 id="moddingflow-activation-title">Загрузка из ModdingFlow</h2>
        </header>
        <dl className="moddingflow-activation-dialog__metadata">
          <div><dt>Мод</dt><dd>{metadata.mod.name}</dd></div>
          <div><dt>Версия</dt><dd>{metadata.version.label}</dd></div>
          <div><dt>Игра</dt><dd>{metadata.game.name}</dd></div>
          <div><dt>Файл</dt><dd>{metadata.file.name}</dd></div>
          <div><dt>Размер</dt><dd>{fileSizeLabel(metadata.file.sizeBytes)}</dd></div>
        </dl>
        <div className="moddingflow-activation-dialog__selection">
          <label>
            <span>Сборка</span>
            <select
              value={snapshot.selectedInstanceId}
              disabled={snapshot.busyAction !== null}
              onChange={(event) => onSelectInstance(event.currentTarget.value)}
            >
              <option value="">Выберите сборку</option>
              {compatibleInstances.map((instance) => (
                <option key={instance.instanceId} value={instance.instanceId}>
                  {instance.instanceName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Профиль</span>
            <select
              value={snapshot.selectedProfileName}
              disabled={!selectedInstance || snapshot.busyAction !== null}
              onChange={(event) => onSelectProfile(event.currentTarget.value)}
            >
              <option value="">Выберите профиль</option>
              {selectedInstance?.profiles.map((profileName) => (
                <option key={profileName} value={profileName}>{profileName}</option>
              ))}
            </select>
          </label>
        </div>
        {snapshot.planPreview ? (
          <div className="moddingflow-activation-dialog__plan">
            <h3>План загрузки</h3>
            <dl className="moddingflow-activation-dialog__metadata">
              <div>
                <dt>Обязательные файлы</dt>
                <dd>{snapshot.planPreview.requiredDownloadCount}</dd>
              </div>
              <div>
                <dt>Исключённые необязательные файлы</dt>
                <dd>{snapshot.planPreview.optionalDownloadCount}</dd>
              </div>
              <div>
                <dt>Требуется места</dt>
                <dd>{fileSizeLabel(snapshot.planPreview.requiredDiskSizeBytes)}</dd>
              </div>
            </dl>
            {snapshot.planPreview.conflictCount > 0 ? (
              <p role="alert">
                План содержит конфликтов: {snapshot.planPreview.conflictCount}. Загрузка заблокирована.
              </p>
            ) : null}
          </div>
        ) : null}
        {snapshot.errorMessage ? <p role="alert">{snapshot.errorMessage}</p> : null}
        <footer className="moddingflow-activation-dialog__actions">
          <button
            className="secondary-button"
            type="button"
            disabled={snapshot.busyAction !== null}
            onClick={onDismiss}
          >
            Отклонить
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={
              (!snapshot.canPreviewPlan && !snapshot.canAccept)
              || snapshot.busyAction !== null
            }
            onClick={snapshot.canAccept ? onAccept : onPreviewPlan}
          >
            {snapshot.busyAction === 'previewingPlan'
              ? 'Проверяем план…'
              : snapshot.busyAction === 'accepting'
                ? 'Подтверждаем…'
                : snapshot.canAccept
                  ? 'Подтвердить загрузку'
                  : snapshot.planPreview?.conflictCount
                    ? 'Проверить снова'
                    : 'Проверить план'}
          </button>
        </footer>
      </section>
    </div>
  );
};

export interface ModdingFlowActivationConfirmationFlowProps {
  activation: FluxoraModdingFlowActivation;
  api: Pick<
    FluxoraApi['moddingFlowActivations'],
    'preview' | 'previewPlan' | 'accept' | 'dismiss'
  >;
  connectAccount: (
    operationId: string
  ) => Promise<Awaited<ReturnType<FluxoraApi['connections']['connect']>>>;
  instances: readonly ModdingFlowActivationInstanceChoice[];
  onRemoved: (artifactId: string) => void;
}

export const ModdingFlowActivationConfirmationFlow = ({
  activation,
  api,
  connectAccount,
  instances,
  onRemoved
}: ModdingFlowActivationConfirmationFlowProps) => {
  const store = useMemo(
    () => createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances,
      onRemoved
    }),
    [activation, api, instances, onRemoved]
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [accountConnectBusy, setAccountConnectBusy] = useState(false);
  const [accountConnectError, setAccountConnectError] = useState<string | null>(null);

  useEffect(() => {
    void store.ensurePreview(
      createRendererOperationId('moddingflow_activation_preview')
    );
  }, [store]);

  return (
    <ModdingFlowActivationConfirmationDialog
      snapshot={snapshot}
      instances={instances}
      accountConnectBusy={accountConnectBusy}
      accountConnectError={accountConnectError}
      onAccept={() => {
        void store.accept(
          createRendererOperationId('moddingflow_activation_accept')
        ).catch(() => undefined);
      }}
      onPreviewPlan={() => {
        void store.previewPlan(
          createRendererOperationId('moddingflow_activation_plan_preview')
        ).catch(() => undefined);
      }}
      onConnectAccount={() => {
        if (accountConnectBusy) {
          return;
        }
        setAccountConnectBusy(true);
        setAccountConnectError(null);
        void connectAccount(
          createRendererOperationId('moddingflow_activation_connect')
        )
          .then((status) => {
            if (status.providerId !== 'moddingflow' || status.state !== 'ready') {
              throw new Error('ModdingFlow authorization did not complete.');
            }
            return store.ensurePreview(
              createRendererOperationId('moddingflow_activation_preview_after_connect')
            );
          })
          .catch(() => {
            setAccountConnectError(
              'Не удалось подключить учётную запись. Повторите попытку.'
            );
          })
          .finally(() => {
            setAccountConnectBusy(false);
          });
      }}
      onDismiss={() => {
        void store.dismiss(
          createRendererOperationId('moddingflow_activation_dismiss')
        ).catch(() => undefined);
      }}
      onSelectInstance={store.selectInstance}
      onSelectProfile={store.selectProfile}
    />
  );
};
