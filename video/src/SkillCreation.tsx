import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {BrianMark, C, Check, Cursor, EASE, FilmBackground, FONT, MONO, Pill, SourceIcon, TopBrand, Window, reveal, sceneOpacity} from './design';

const sources = [
  {type: 'slack' as const, label: 'Slack', signal: 'No Friday production pushes', meta: '#engineering · 18 replies'},
  {type: 'gmail' as const, label: 'Gmail', signal: 'Notify GTM 48h before launch', meta: 'Launch readiness thread'},
  {type: 'ticket' as const, label: 'Support tickets', signal: 'Schema changes drive 3× incidents', meta: '42 resolved tickets'},
  {type: 'docs' as const, label: 'Drive + docs', signal: 'Every rollout needs a rollback owner', meta: 'Release playbook v12'},
  {type: 'database' as const, label: 'Your database', signal: 'Error budget must stay below 0.3%', meta: '90 days of deploy telemetry'},
];

const SourceScene = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 0, 220)}}>
      <TopBrand label="Film 01 · learn" />
      <Window title="Brian / Sources" right={<Pill tone="green"><span style={{width: 7, height: 7, borderRadius: 99, background: C.green}} />5 connected</Pill>} style={{position: 'absolute', left: 70, right: 70, top: 108, bottom: 54}}>
        <div style={{display: 'grid', gridTemplateColumns: '290px 1fr', height: '100%'}}>
          <aside style={{padding: '34px 28px', borderRight: `1px solid ${C.border}`, background: '#f7f3eb'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 12}}><BrianMark size={42} dark /><div><div style={{fontSize: 19, fontWeight: 750}}>Release approvals</div><div style={{fontFamily: MONO, fontSize: 13, color: C.muted, marginTop: 3}}>Focused learning goal</div></div></div>
            <div style={{marginTop: 32, fontFamily: MONO, fontSize: 13, color: C.muted, textTransform: 'uppercase', letterSpacing: '.1em'}}>What Brian looks for</div>
            {['required evidence', 'approval order', 'failure patterns', 'stop conditions'].map((item, i) => <div key={item} style={{...reveal(frame, 20 + i * 7, 14), display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, fontSize: 17}}><span style={{width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', background: C.accentSoft, color: C.accent}}><Check size={13} /></span>{item}</div>)}
            <div style={{marginTop: 48, padding: '18px', borderRadius: 15, background: C.ink, color: '#fff'}}>
              <div style={{fontFamily: MONO, fontSize: 13, color: 'rgba(255,255,255,.54)'}}>live scan</div>
              <div style={{fontSize: 34, fontWeight: 760, marginTop: 8}}>{Math.round(interpolate(frame, [45, 175], [0, 286], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}))}</div>
              <div style={{fontSize: 14, color: 'rgba(255,255,255,.66)'}}>threads & records reviewed</div>
            </div>
          </aside>
          <main style={{padding: '28px 32px 34px'}}>
            <div style={{display: 'flex', alignItems: 'end', justifyContent: 'space-between'}}>
              <div><div style={{fontSize: 36, fontWeight: 780, letterSpacing: '-.035em'}}>Learn from where the work already lives.</div><div style={{fontSize: 18, color: C.muted, marginTop: 7}}>Read-only signals. Focused on one operating process.</div></div>
              <Pill tone="orange">Syncing focused sources</Pill>
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 26}}>
              {sources.map((source, i) => {
                const start = 28 + i * 20;
                const progress = interpolate(frame, [start + 15, start + 58], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE});
                return (
                  <div key={source.label} style={{...reveal(frame, start), minHeight: 128, padding: '20px 20px', borderRadius: 18, border: `1px solid ${progress > .92 ? 'rgba(28,148,96,.4)' : C.border}`, background: progress > .92 ? '#fbfffc' : '#fff', display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 14, alignItems: 'start', boxShadow: '0 8px 24px rgba(62,45,25,.06)'}}>
                    <SourceIcon type={source.type} size={48} />
                    <div><div style={{fontSize: 18, fontWeight: 760}}>{source.label}</div><div style={{fontSize: 16, marginTop: 9, color: C.ink}}>{source.signal}</div><div style={{fontFamily: MONO, fontSize: 12, color: C.muted, marginTop: 8}}>{source.meta}</div></div>
                    <div style={{width: 26, height: 26, borderRadius: 99, background: progress > .92 ? C.greenSoft : C.paperMuted, display: 'grid', placeItems: 'center', color: C.green}}>{progress > .92 ? <Check size={15} /> : <span style={{width: 7, height: 7, borderRadius: 99, background: C.muted}} />}</div>
                    <div style={{gridColumn: '1 / -1', height: 4, borderRadius: 99, background: C.paperMuted, overflow: 'hidden'}}><div style={{height: '100%', width: `${progress * 100}%`, background: `linear-gradient(90deg, ${C.accentBright}, ${C.green})`}} /></div>
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </Window>
    </div>
  );
};

const EvidenceScene = () => {
  const frame = useCurrentFrame();
  const local = frame - 180;
  const packets = sources.map((s, i) => ({...s, y: 112 + i * 108}));
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 200, 440)}}>
      <TopBrand label="Film 01 · learn" />
      <div style={{position: 'absolute', left: 72, right: 72, top: 116, bottom: 60, display: 'grid', gridTemplateColumns: '430px 210px 1fr', gap: 24}}>
        <div style={{position: 'relative'}}>
          <div style={{color: '#fff', fontSize: 39, fontWeight: 780, letterSpacing: '-.04em'}}>Five systems.<br /><span style={{color: '#eaa178'}}>One operating truth.</span></div>
          <div style={{position: 'absolute', left: 0, right: 0, top: 112}}>
            {packets.map((p, i) => <div key={p.label} style={{...reveal(local, 10 + i * 14), height: 88, marginBottom: 14, borderRadius: 16, border: '1px solid rgba(255,255,255,.11)', background: 'rgba(255,255,255,.065)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 17px', color: '#fff'}}><SourceIcon type={p.type} size={44} /><div><div style={{fontSize: 16, fontWeight: 700}}>{p.label}</div><div style={{fontSize: 14, color: 'rgba(255,255,255,.6)', marginTop: 4}}>{p.signal}</div></div><Check size={17} color="#71cf9f" /></div>)}
          </div>
        </div>
        <div style={{display: 'grid', placeItems: 'center', position: 'relative'}}>
          <svg width="210" height="650" viewBox="0 0 210 650" style={{position: 'absolute', inset: 0}}>
            {packets.map((_, i) => {
              const line = interpolate(local, [28 + i * 14, 70 + i * 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
              return <path key={i} d={`M0 ${155 + i * 102} C75 ${155 + i * 102}, 70 325, 105 325`} fill="none" stroke="rgba(234,161,120,.68)" strokeWidth="2" strokeDasharray="220" strokeDashoffset={220 * (1 - line)} />;
            })}
            <path d="M105 325 C145 325 145 325 210 325" fill="none" stroke="rgba(234,161,120,.76)" strokeWidth="2" strokeDasharray="130" strokeDashoffset={130 * (1 - interpolate(local, [115, 160], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}))} />
          </svg>
          <div style={{...reveal(local, 65), width: 142, height: 142, borderRadius: 42, display: 'grid', placeItems: 'center', background: 'linear-gradient(145deg,#ef6c28,#b83d0f)', border: '1px solid rgba(255,255,255,.25)', boxShadow: '0 30px 80px rgba(209,82,26,.42)'}}><BrianMark size={70} /></div>
          <div style={{...reveal(local, 100), position: 'absolute', top: 433, width: 180, textAlign: 'center', color: 'rgba(255,255,255,.65)', fontFamily: MONO, fontSize: 14, lineHeight: 1.55}}>noise removed<br /><span style={{color: '#fff'}}>evidence clustered</span></div>
        </div>
        <div style={{...reveal(local, 130)}}>
          <Window title="Draft skill · release-approval" right={<Pill tone="orange">needs review</Pill>} style={{height: '100%', boxShadow: '0 40px 100px rgba(0,0,0,.5)'}}>
            <div style={{padding: '28px 30px'}}>
              <div style={{fontFamily: MONO, color: C.muted, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.09em'}}>Production release approval</div>
              <div style={{fontSize: 33, fontWeight: 780, marginTop: 8, letterSpacing: '-.035em'}}>Ship safely, with the right people in the loop.</div>
              <div style={{marginTop: 24, display: 'grid', gap: 12}}>
                {['Confirm error budget is below 0.3%', 'Assign a rollback owner', 'Notify go-to-market 48h before launch'].map((line, i) => <div key={line} style={{...reveal(local, 150 + i * 12), display: 'grid', gridTemplateColumns: '30px 1fr', gap: 12, alignItems: 'center', padding: '13px 15px', border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', fontSize: 17}}><span style={{width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: C.accentSoft, color: C.accent, fontFamily: MONO, fontWeight: 800}}>{i + 1}</span>{line}</div>)}
              </div>
              <div style={{...reveal(local, 190), marginTop: 16, borderRadius: 14, background: C.redSoft, color: C.red, padding: '15px 17px', fontSize: 16, fontWeight: 650}}><span style={{fontFamily: MONO, fontSize: 12, textTransform: 'uppercase'}}>guardrail · </span>Stop if tests fail or rollback has no owner.</div>
              <div style={{...reveal(local, 210), marginTop: 20, display: 'flex', gap: 7}}>{sources.map(s => <SourceIcon key={s.label} type={s.type} size={32} />)}<span style={{marginLeft: 8, color: C.muted, fontSize: 14, alignSelf: 'center'}}>12 linked evidence items</span></div>
            </div>
          </Window>
        </div>
      </div>
    </div>
  );
};

const ReviewScene = () => {
  const frame = useCurrentFrame();
  const local = frame - 420;
  const click = interpolate(local, [116, 123, 132], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const approved = local >= 124;
  const cursorX = interpolate(local, [28, 96], [1180, 1288], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE});
  const cursorY = interpolate(local, [28, 96], [650, 739], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE});
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 420, 660, 18)}}>
      <TopBrand label="Film 01 · learn" />
      <Window title="Brian / Review queue / Production release approval" right={<Pill tone={approved ? 'green' : 'orange'}>{approved ? <><Check size={14} />live · v5</> : 'human review'}</Pill>} style={{position: 'absolute', left: 70, right: 70, top: 108, bottom: 54}}>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 370px', height: '100%'}}>
          <main style={{padding: '31px 36px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 13}}><div style={{fontSize: 35, fontWeight: 790, letterSpacing: '-.04em'}}>Production release approval</div><Pill tone="neutral">draft · v5</Pill></div>
            <div style={{marginTop: 8, fontSize: 17, color: C.muted}}>A reviewed procedure assembled from the way your team actually ships.</div>
            <div style={{marginTop: 27, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
              <div style={{borderRadius: 16, border: `1px solid ${C.border}`, padding: 20, background: '#fff'}}><div style={{fontFamily: MONO, fontSize: 13, color: C.muted, textTransform: 'uppercase'}}>procedure</div>{['Check error budget and open incidents', 'Assign owner and rollback path', 'Notify stakeholders 48h ahead', 'Ship Tuesday–Thursday only'].map((t, i) => <div key={t} style={{...reveal(local, 12 + i * 7), display: 'flex', gap: 12, marginTop: 16, fontSize: 17, lineHeight: 1.4}}><span style={{color: C.accent, fontFamily: MONO, fontWeight: 800}}>0{i + 1}</span>{t}</div>)}</div>
              <div style={{display: 'grid', gap: 16}}><div style={{borderRadius: 16, padding: 20, background: C.redSoft, color: C.red}}><div style={{fontFamily: MONO, fontSize: 13, textTransform: 'uppercase'}}>stop conditions</div><div style={{fontSize: 17, lineHeight: 1.5, marginTop: 12}}>Failed checks, no rollback owner, or error budget ≥ 0.3%.</div></div><div style={{borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, background: '#fff'}}><div style={{fontFamily: MONO, fontSize: 13, color: C.muted, textTransform: 'uppercase'}}>tone context</div><div style={{fontSize: 17, lineHeight: 1.5, marginTop: 12}}>Updates are short, direct, calm, and end with the owner + next step.</div></div></div>
            </div>
            <div style={{marginTop: 22, display: 'flex', justifyContent: 'flex-end', gap: 12}}><div style={{padding: '13px 22px', borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 17, fontWeight: 650}}>Request changes</div><div style={{padding: '13px 24px', borderRadius: 12, background: approved ? C.green : C.accent, color: '#fff', fontSize: 17, fontWeight: 750, boxShadow: '0 10px 24px rgba(209,82,26,.25)'}}>{approved ? 'Approved & live' : 'Approve & activate'}</div></div>
          </main>
          <aside style={{borderLeft: `1px solid ${C.border}`, background: '#f7f3eb', padding: '30px 24px'}}>
            <div style={{fontFamily: MONO, fontSize: 13, color: C.muted, textTransform: 'uppercase'}}>why Brian believes this</div>
            {sources.map((s, i) => <div key={s.label} style={{...reveal(local, 24 + i * 8), display: 'flex', gap: 12, marginTop: 17, paddingBottom: 17, borderBottom: `1px solid ${C.border}`}}><SourceIcon type={s.type} size={39} /><div><div style={{fontWeight: 730, fontSize: 16}}>{s.label}</div><div style={{fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.35}}>{s.meta}</div></div></div>)}
            <div style={{...reveal(local, 78), marginTop: 20, color: C.green, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8}}><Check size={17} />Every rule links to source evidence</div>
          </aside>
        </div>
      </Window>
      <Cursor x={cursorX} y={cursorY} click={click} />
      {approved && <div style={{...reveal(local, 127), position: 'absolute', left: 0, right: 0, bottom: 76, display: 'grid', placeItems: 'center', pointerEvents: 'none'}}><div style={{padding: '13px 20px', borderRadius: 999, background: C.ink, color: '#fff', fontFamily: MONO, fontSize: 14, boxShadow: '0 15px 40px rgba(0,0,0,.3)'}}>Skill is live for every connected agent</div></div>}
    </div>
  );
};

export const SkillCreation = () => (
  <AbsoluteFill>
    <FilmBackground>
      <SourceScene />
      <EvidenceScene />
      <ReviewScene />
    </FilmBackground>
  </AbsoluteFill>
);
