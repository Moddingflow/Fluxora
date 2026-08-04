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
import { useLocalization } from '../../../localization/react';
import type { TranslationKey } from '../../../localization';

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

const fileSizeLabel = (sizeBytes: number | null, unknownLabel: string): string => {
  if (sizeBytes === null) {
    return unknownLabel;
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
  const { t } = useLocalization();
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
            <h2 id="moddingflow-activation-title">{t('moddingflow.downloadTitle')}</h2>
          </header>
          <div
            className="moddingflow-activation-dialog__skeleton"
            aria-label={t('moddingflow.checkingFile')}
          >
            <span className="flx-skeleton" />
            <span className="flx-skeleton" />
            <span className="flx-skeleton" />
          </div>
          <footer className="moddingflow-activation-dialog__actions">
            <button className="secondary-button" type="button" onClick={onDismiss}>
              {t('moddingflow.dismiss')}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  if (snapshot.state !== 'available') {
    const stateCopy: Record<Exclude<typeof snapshot.state, 'idle' | 'loading' | 'available'>, {
      title: TranslationKey;
      detail: TranslationKey;
    }> = {
      unknown: {
        title: 'moddingflow.state.unknown.title',
        detail: 'moddingflow.state.unknown.detail'
      },
      deleted: {
        title: 'moddingflow.state.deleted.title',
        detail: 'moddingflow.state.deleted.detail'
      },
      ineligible: {
        title: 'moddingflow.state.ineligible.title',
        detail: 'moddingflow.state.ineligible.detail'
      },
      disconnected: {
        title: 'moddingflow.state.disconnected.title',
        detail: 'moddingflow.state.disconnected.detail'
      },
      unsupportedGame: {
        title: 'moddingflow.state.unsupportedGame.title',
        detail: 'moddingflow.state.unsupportedGame.detail'
      },
      unavailable: {
        title: 'moddingflow.state.unavailable.title',
        detail: 'moddingflow.state.unavailable.detail'
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
            <h2 id="moddingflow-activation-state-title">{t(copy.title)}</h2>
          </header>
          <p className="moddingflow-activation-dialog__state-copy">{t(copy.detail)}</p>
          {accountConnectError ? <p role="alert">{accountConnectError}</p> : null}
          {snapshot.errorMessage ? <p role="alert">{t('moddingflow.error.generic')}</p> : null}
          <footer className="moddingflow-activation-dialog__actions">
            <button
              className="secondary-button"
              type="button"
              disabled={snapshot.busyAction !== null}
              onClick={onDismiss}
            >
              {snapshot.busyAction === 'dismissing'
                ? t('moddingflow.dismissing')
                : t('moddingflow.dismiss')}
            </button>
            {snapshot.state === 'disconnected' && onConnectAccount ? (
              <button
                className="primary-button"
                type="button"
                disabled={accountConnectBusy || snapshot.busyAction !== null}
                onClick={onConnectAccount}
              >
                {accountConnectBusy ? t('moddingflow.connecting') : t('moddingflow.connect')}
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
            <h2 id="moddingflow-activation-no-instance-title">{t('moddingflow.noCompatibleBuild')}</h2>
          </header>
          <p className="moddingflow-activation-dialog__state-copy">
            {t('moddingflow.noCompatibleBuildDetail', { game: metadata.game.name })}
          </p>
          <footer className="moddingflow-activation-dialog__actions">
            <button className="secondary-button" type="button" onClick={onDismiss}>
              {t('moddingflow.dismiss')}
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
          <h2 id="moddingflow-activation-title">{t('moddingflow.downloadTitle')}</h2>
        </header>
        <dl className="moddingflow-activation-dialog__metadata">
          <div><dt>{t('moddingflow.mod')}</dt><dd>{metadata.mod.name}</dd></div>
          <div><dt>{t('moddingflow.version')}</dt><dd>{metadata.version.label}</dd></div>
          <div><dt>{t('moddingflow.game')}</dt><dd>{metadata.game.name}</dd></div>
          <div><dt>{t('moddingflow.file')}</dt><dd>{metadata.file.name}</dd></div>
          <div><dt>{t('moddingflow.size')}</dt><dd>{fileSizeLabel(metadata.file.sizeBytes, t('moddingflow.sizeUnknown'))}</dd></div>
        </dl>
        <div className="moddingflow-activation-dialog__selection">
          <label>
            <span>{t('moddingflow.build')}</span>
            <select
              value={snapshot.selectedInstanceId}
              disabled={snapshot.busyAction !== null}
              onChange={(event) => onSelectInstance(event.currentTarget.value)}
            >
              <option value="">{t('moddingflow.selectBuild')}</option>
              {compatibleInstances.map((instance) => (
                <option key={instance.instanceId} value={instance.instanceId}>
                  {instance.instanceName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('moddingflow.profile')}</span>
            <select
              value={snapshot.selectedProfileName}
              disabled={!selectedInstance || snapshot.busyAction !== null}
              onChange={(event) => onSelectProfile(event.currentTarget.value)}
            >
              <option value="">{t('moddingflow.selectProfile')}</option>
              {selectedInstance?.profiles.map((profileName) => (
                <option key={profileName} value={profileName}>{profileName}</option>
              ))}
            </select>
          </label>
        </div>
        {snapshot.planPreview ? (
          <div className="moddingflow-activation-dialog__plan">
            <h3>{t('moddingflow.plan')}</h3>
            <dl className="moddingflow-activation-dialog__metadata">
              <div>
                <dt>{t('moddingflow.requiredFiles')}</dt>
                <dd>{snapshot.planPreview.requiredDownloadCount}</dd>
              </div>
              <div>
                <dt>{t('moddingflow.excludedOptional')}</dt>
                <dd>{snapshot.planPreview.optionalDownloadCount}</dd>
              </div>
              <div>
                <dt>{t('moddingflow.spaceRequired')}</dt>
                <dd>{fileSizeLabel(snapshot.planPreview.requiredDiskSizeBytes, t('moddingflow.sizeUnknown'))}</dd>
              </div>
            </dl>
            {snapshot.planPreview.conflictCount > 0 ? (
              <p role="alert">
                {t('moddingflow.conflicts', { count: snapshot.planPreview.conflictCount })}
              </p>
            ) : null}
          </div>
        ) : null}
        {snapshot.errorMessage ? <p role="alert">{t('moddingflow.error.generic')}</p> : null}
        <footer className="moddingflow-activation-dialog__actions">
          <button
            className="secondary-button"
            type="button"
            disabled={snapshot.busyAction !== null}
            onClick={onDismiss}
          >
            {t('moddingflow.dismiss')}
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
              ? t('moddingflow.checkingPlan')
              : snapshot.busyAction === 'accepting'
                ? t('moddingflow.accepting')
                : snapshot.canAccept
                  ? t('moddingflow.confirmDownload')
                  : snapshot.planPreview?.conflictCount
                    ? t('moddingflow.checkAgain')
                    : t('moddingflow.checkPlan')}
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
  const { t } = useLocalization();
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
              throw new Error(t('app.error.moddingFlowAuthorizationIncomplete'));
            }
            return store.ensurePreview(
              createRendererOperationId('moddingflow_activation_preview_after_connect')
            );
          })
          .catch(() => {
            setAccountConnectError(
              t('moddingflow.error.connect')
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
