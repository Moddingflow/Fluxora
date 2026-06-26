import { useState } from 'react';

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

const previewTabs = [
  { count: 128, label: 'Plugins', value: 'plugins' },
  { count: 18, label: 'Data', value: 'data' },
  { count: 4, label: 'Downloads', value: 'downloads' }
];

export function PrimitivePreview() {
  const [activeTab, setActiveTab] = useState('plugins');
  const [enabled, setEnabled] = useState(true);
  const [checked, setChecked] = useState(true);

  return (
    <section className="primitive-preview" aria-label="Design system primitives preview">
      <header className="primitive-preview__header">
        <div>
          <SectionLabel>Design system</SectionLabel>
          <h1>Fluxora primitives</h1>
        </div>
        <Badge tone="accent">Dev only</Badge>
      </header>

      <div className="primitive-preview__grid">
        <Card className="primitive-preview__panel">
          <SectionLabel>Actions</SectionLabel>
          <div className="primitive-preview__row">
            <Button iconLeft={<Icon name="plus" size={15} />}>New build</Button>
            <Button iconLeft={<Icon name="refresh" size={15} />} variant="secondary">
              Refresh
            </Button>
            <Button variant="ghost">Details</Button>
            <IconButton label="Open settings" variant="boxed">
              <Icon name="settings" size={16} />
            </IconButton>
          </div>
          <div className="primitive-preview__row">
            <Input
              aria-label="Search preview"
              leadingIcon={<Icon name="search" size={15} />}
              placeholder="Search builds"
            />
            <Select
              aria-label="Game"
              defaultValue="skyrim"
              options={[
                { label: 'Skyrim Special Edition', value: 'skyrim' },
                { label: 'Fallout 4', value: 'fallout' }
              ]}
            />
          </div>
        </Card>

        <Card className="primitive-preview__panel">
          <SectionLabel>State</SectionLabel>
          <div className="primitive-preview__stack">
            <Switch checked={enabled} label="Nexus integration" onCheckedChange={setEnabled} />
            <Checkbox checked={checked} label="Enable selected mod" onCheckedChange={setChecked} />
            <div className="primitive-preview__row">
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="accent">Active</Badge>
              <StatusDot state="overwrites" />
              <StatusDot state="overwritten" />
              <StatusDot state="fully-overwritten" />
            </div>
          </div>
        </Card>

        <Card className="primitive-preview__panel">
          <SectionLabel>Navigation</SectionLabel>
          <div className="primitive-preview__stack">
            <Tabs onValueChange={setActiveTab} tabs={previewTabs} value={activeTab} />
            <NavItem
              active
              hint="Active build"
              icon={<Icon name="layers" size={17} />}
              label="Load order"
            />
            <NavItem hint="Operation scoped" icon={<Icon name="transfer" size={17} />} label="Transfer" />
          </div>
        </Card>

        <Card className="primitive-preview__panel">
          <SectionLabel>Feedback</SectionLabel>
          <div className="primitive-preview__stack">
            <ProgressBar label="Installing archive" value={62} valueLabel="62%" />
            <div className="primitive-preview__row">
              <FacetSpinner size={34} />
              <EmptyState
                compact
                description="Choose a build to inspect mods and plugins."
                icon={<Icon name="folder" size={20} />}
                title="No build selected"
              />
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
