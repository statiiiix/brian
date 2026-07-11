import {Composition} from 'remotion';
import {SkillCreation} from './SkillCreation';
import {SkillExecution} from './SkillExecution';

export const VIDEO_WIDTH = 1600;
export const VIDEO_HEIGHT = 900;
export const VIDEO_FPS = 30;
export const VIDEO_DURATION = 660;

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="SkillCreation"
        component={SkillCreation}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={VIDEO_FPS}
        durationInFrames={VIDEO_DURATION}
      />
      <Composition
        id="SkillExecution"
        component={SkillExecution}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={VIDEO_FPS}
        durationInFrames={VIDEO_DURATION}
      />
    </>
  );
};
