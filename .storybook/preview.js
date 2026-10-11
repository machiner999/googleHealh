import '../public/styles.css';

export default {
  parameters: {
    layout: 'fullscreen',
    viewport: {
      options: {
        runningMobile: { name: 'モバイル 412 × 780', styles: { width: '412px', height: '780px' }, type: 'mobile' },
        smallMobile: { name: '小さい画面 360 × 640', styles: { width: '360px', height: '640px' }, type: 'mobile' },
        desktop: { name: 'デスクトップ', styles: { width: '1280px', height: '900px' }, type: 'desktop' }
      }
    },
    options: { storySort: { order: ['ランニング'] } }
  },
  initialGlobals: { viewport: { value: 'runningMobile', isRotated: false } }
};
