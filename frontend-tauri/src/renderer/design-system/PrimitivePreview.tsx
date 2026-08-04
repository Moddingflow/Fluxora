import { useMemo, useState } from 'react';

import { useLocalization } from '../../localization/react';
import { Icon } from './icons';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FacetSpinner,
  IconButton,
  Input,
  NavItem,
  ProgressBar,
  SectionLabel,
  Select,
  StatusDot,
  Switch,
  Tabs
} from './primitives';

export function PrimitivePreview() {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = useState('plugins');
  const [enabled, setEnabled] = useState(true);
  const [checked, setChecked] = useState(true);
  const previewTabs = useMemo(() => [
    { count: 128, label: t('preview.plugins'), value: 'plugins' },
    { count: 18, label: t('preview.data'), value: 'data' },
    { count: 4, label: t('preview.downloads'), value: 'downloads' }
  ], [t]);

  return (
    <section className="primitive-preview" aria-label={t('preview.aria')}>
      <header className="primitive-preview__header">
        <div>
          <SectionLabel>{t('preview.designSystem')}</SectionLabel>
          <h1>{t('preview.title')}</h1>
        </div>
        <Badge tone="accent">{t('preview.devOnly')}</Badge>
      </header>

      <div className="primitive-preview__grid">
        <Card className="primitive-preview__panel">
          <SectionLabel>{t('preview.actions')}</SectionLabel>
          <div className="primitive-preview__row">
            <Button iconLeft={<Icon name="plus" size={15} />}>{t('preview.newBuild')}</Button>
            <Button iconLeft={<Icon name="refresh" size={15} />} variant="secondary">
              {t('preview.refresh')}
            </Button>
            <Button variant="ghost">{t('preview.details')}</Button>
            <IconButton label={t('preview.openSettings')} variant="boxed">
              <Icon name="settings" size={16} />
            </IconButton>
          </div>
          <div className="primitive-preview__row">
            <Input
              aria-label={t('preview.search')}
              leadingIcon={<Icon name="search" size={15} />}
              placeholder={t('preview.searchBuilds')}
            />
            <Select
              aria-label={t('preview.game')}
              defaultValue="skyrim"
              options={[
                { label: t('preview.skyrim'), value: 'skyrim' },
                { label: t('preview.fallout'), value: 'fallout' }
              ]}
            />
          </div>
        </Card>

        <Card className="primitive-preview__panel">
          <SectionLabel>{t('preview.state')}</SectionLabel>
          <div className="primitive-preview__stack">
            <Switch checked={enabled} label={t('preview.nexus')} onCheckedChange={setEnabled} />
            <Checkbox checked={checked} label={t('preview.enableMod')} onCheckedChange={setChecked} />
            <div className="primitive-preview__row">
              <Badge tone="neutral">{t('preview.neutral')}</Badge>
              <Badge tone="accent">{t('preview.active')}</Badge>
              <StatusDot state="overwrites" />
              <StatusDot state="overwritten" />
              <StatusDot state="fully-overwritten" />
            </div>
          </div>
        </Card>

        <Card className="primitive-preview__panel">
          <SectionLabel>{t('preview.navigation')}</SectionLabel>
          <div className="primitive-preview__stack">
            <Tabs onValueChange={setActiveTab} tabs={previewTabs} value={activeTab} />
            <NavItem
              active
              hint={t('preview.activeBuild')}
              icon={<Icon name="layers" size={17} />}
              label={t('preview.loadOrder')}
            />
            <NavItem hint={t('preview.operationScoped')} icon={<Icon name="transfer" size={17} />} label={t('preview.transfer')} />
          </div>
        </Card>

        <Card className="primitive-preview__panel">
          <SectionLabel>{t('preview.feedback')}</SectionLabel>
          <div className="primitive-preview__stack">
            <ProgressBar label={t('preview.installing')} value={62} valueLabel="62%" />
            <div className="primitive-preview__row">
              <FacetSpinner size={34} />
              <EmptyState
                compact
                description={t('preview.noBuildDescription')}
                icon={<Icon name="folder" size={20} />}
                title={t('preview.noBuild')}
              />
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
