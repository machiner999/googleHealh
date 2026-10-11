import { addons } from 'storybook/manager-api';

// Leave room for the portrait preview while keeping the controls available.
addons.setConfig({ panelPosition: 'right', initialActive: 'canvas' });
