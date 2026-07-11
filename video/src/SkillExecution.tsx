import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {BrianMark, C, Check, Cursor, EASE, FilmBackground, FONT, MONO, Pill, SourceIcon, TopBrand, Window, reveal, sceneOpacity} from './design';

const BriefScene = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 0, 175)}}>
      <TopBrand label="Film 02 · execute" />
      <Window title="Codex / Brian enabled" right={<Pill tone="green"><span style={{width: 7, height: 7, borderRadius: 99, background: C.green}} />Brian online</Pill>} style={{position: 'absolute', left: 120, right: 120, top: 132, bottom: 92}}>
        <div style={{display: 'grid', gridTemplateColumns: '240px 1fr', height: '100%'}}>
          <aside style={{padding: 28, background: '#f2ede3', borderRight: `1px solid ${C.border}`}}><div style={{fontFamily: MONO, fontSize: 13, color: C.muted}}>WORKSPACE</div>{['api', 'migrations', 'tests', 'release'].map((t, i) => <div key={t} style={{marginTop: 18, color: i === 1 ? C.ink : C.muted, fontSize: 16, fontWeight: i === 1 ? 720 : 500}}>▾ {t}</div>)}<div style={{marginTop: 34, paddingTop: 22, borderTop: `1px solid ${C.border}`}}><div style={{fontFamily: MONO, fontSize: 12, color: C.muted}}>BRIAN CONTEXT</div><div style={{marginTop: 12}}><Pill tone="green">release-approval · v5</Pill></div></div></aside>
          <main style={{padding: '38px 44px'}}>
            <div style={{...reveal(frame, 18), maxWidth: 840, borderRadius: 18, background: C.paperMuted, padding: '22px 26px', fontSize: 23, lineHeight: 1.5}}><span style={{fontFamily: MONO, fontSize: 13, color: C.muted, display: 'block', marginBottom: 8}}>YOU</span>Prepare Tuesday’s rollout. Reply to Maya in my tone, patch the migration retry, run tests, and open the PR if it’s safe.</div>
            <div style={{...reveal(frame, 52), marginTop: 28, display: 'flex', alignItems: 'flex-start', gap: 16}}><BrianMark size={50} /><div style={{flex: 1}}><div style={{fontSize: 17, fontWeight: 760}}>Brian is briefing the agent</div><div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16}}>{[
              ['skill', 'Production release approval · v5'],
              ['tone', 'Short · direct · warm'],
              ['guardrail', 'Stop on failed checks'],
              ['context', 'Maya owns go-to-market notice'],
            ].map(([k, v], i) => <div key={k} style={{...reveal(frame, 66 + i * 10), border: `1px solid ${C.border}`, borderRadius: 13, background: '#fff', padding: '15px 17px'}}><span style={{fontFamily: MONO, fontSize: 12, color: C.accent, textTransform: 'uppercase'}}>{k}</span><div style={{fontSize: 16, marginTop: 7, fontWeight: 650}}>{v}</div></div>)}</div></div></div>
            <div style={{...reveal(frame, 116), marginTop: 24, display: 'flex', gap: 10, color: C.green, fontSize: 16, fontWeight: 700}}><Check size={18} />Plan is grounded in a reviewed skill and current company context.</div>
          </main>
        </div>
      </Window>
    </div>
  );
};

const EmailScene = () => {
  const frame = useCurrentFrame();
  const local = frame - 140;
  const reply = `Maya — Tuesday is good. The retry patch is in review and the rollback owner is confirmed.\n\nI’ll send the final go/no-go by 3pm Monday. — Sam`;
  const chars = Math.floor(interpolate(local, [110, 205], [0, reply.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const click = interpolate(local, [229, 236, 244], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const sent = local >= 240;
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 155, 430)}}>
      <TopBrand label="Film 02 · execute" />
      <Window title="Gmail / Reply with Brian" right={<Pill tone={sent ? 'green' : 'blue'}>{sent ? <><Check size={14} />sent</> : 'tone matched'}</Pill>} style={{position: 'absolute', left: 70, right: 70, top: 108, bottom: 54}}>
        <div style={{display: 'grid', gridTemplateColumns: '390px 1fr', height: '100%'}}>
          <aside style={{padding: '28px 25px', background: '#f5f0e7', borderRight: `1px solid ${C.border}`}}>
            <div style={{fontFamily: MONO, fontSize: 12, color: C.muted, textTransform: 'uppercase'}}>Brian found your writing pattern</div>
            <div style={{fontSize: 29, fontWeight: 780, marginTop: 9, letterSpacing: '-.03em'}}>Sounds like you,<br />because it learned from you.</div>
            {[
              ['Launch note', '“Tuesday works. I’ll own the go/no-go.”'],
              ['Risk update', '“Short version: tests pass, rollback is ready.”'],
              ['Team reply', '“Good catch. Fix is in review. More by 3pm.”'],
            ].map(([title, body], i) => <div key={title} style={{...reveal(local, 18 + i * 12), marginTop: 18, borderRadius: 14, background: '#fff', border: `1px solid ${C.border}`, padding: '16px 17px'}}><div style={{fontFamily: MONO, fontSize: 11, color: C.muted}}>{title} · sent by Sam</div><div style={{fontSize: 15, lineHeight: 1.45, marginTop: 8}}>{body}</div></div>)}
            <div style={{...reveal(local, 62), display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 20}}><Pill tone="orange">concise</Pill><Pill tone="orange">calm</Pill><Pill tone="orange">owner + next step</Pill></div>
          </aside>
          <main style={{padding: '28px 35px', position: 'relative'}}>
            <div style={{fontSize: 15, color: C.muted}}>Subject</div><div style={{fontSize: 24, fontWeight: 720, marginTop: 5, paddingBottom: 18, borderBottom: `1px solid ${C.border}`}}>Re: Tuesday enterprise rollout</div>
            <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 19}}><div style={{width: 40, height: 40, borderRadius: 99, background: C.blueSoft, color: C.blue, display: 'grid', placeItems: 'center', fontWeight: 800}}>M</div><div><div style={{fontWeight: 720}}>Maya Khalil</div><div style={{fontSize: 13, color: C.muted, marginTop: 2}}>to Sam · 11:42 AM</div></div></div>
            <div style={{...reveal(local, 35), marginTop: 22, maxWidth: 800, padding: '18px 20px', borderLeft: `3px solid ${C.border}`, color: C.muted, fontSize: 17, lineHeight: 1.5}}>Can we confirm Tuesday? Sales needs a clear date and I want to know who owns rollback if the migration gets noisy.</div>
            <div style={{...reveal(local, 80), marginTop: 24, borderRadius: 16, border: `1px solid ${C.border}`, background: '#fff', minHeight: 205, padding: '20px 22px', fontSize: 19, lineHeight: 1.55, whiteSpace: 'pre-wrap', position: 'relative'}}>
              <div style={{fontFamily: MONO, fontSize: 11, color: C.accent, textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8}}><BrianMark size={24} dark />drafted using your tone + release-approval v5</div>
              {reply.slice(0, chars)}<span style={{display: chars < reply.length ? 'inline-block' : 'none', width: 2, height: 22, background: C.accent, marginLeft: 2, verticalAlign: 'middle'}} />
            </div>
            <div style={{position: 'absolute', right: 35, bottom: 28, padding: '13px 25px', borderRadius: 12, color: '#fff', background: sent ? C.green : C.accent, fontWeight: 760, fontSize: 17, boxShadow: '0 12px 26px rgba(209,82,26,.24)'}}>{sent ? 'Sent ✓' : 'Send reply'}</div>
          </main>
        </div>
      </Window>
      <Cursor x={interpolate(local, [180, 224], [1160, 1420], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE})} y={interpolate(local, [180, 224], [560, 772], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE})} click={click} />
    </div>
  );
};

const CodeScene = () => {
  const frame = useCurrentFrame();
  const local = frame - 390;
  const testsDone = local >= 112;
  const prReady = local >= 160;
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 410, 600)}}>
      <TopBrand label="Film 02 · execute" />
      <Window title="Cursor / migration-retry.ts" right={<Pill tone={prReady ? 'green' : 'blue'}>{prReady ? <><Check size={14} />PR ready</> : 'Brian skill active'}</Pill>} style={{position: 'absolute', left: 70, right: 70, top: 108, bottom: 54, background: '#171916', color: '#e9eadf', borderColor: 'rgba(255,255,255,.13)'}}>
        <div style={{display: 'grid', gridTemplateColumns: '240px 1fr 420px', height: '100%', background: '#171916'}}>
          <aside style={{padding: '26px 22px', borderRight: `1px solid ${C.darkBorder}`, background: '#141512'}}><div style={{fontFamily: MONO, fontSize: 12, color: '#878d82'}}>EXPLORER</div>{['src', '  api', '  db', '    migration-retry.ts', 'tests', '  migration-retry.test.ts'].map((x, i) => <div key={i} style={{marginTop: 14, fontFamily: MONO, fontSize: 14, color: i === 3 ? '#fff' : '#90968c', background: i === 3 ? 'rgba(255,255,255,.06)' : 'transparent', padding: i === 3 ? '7px 8px' : 0, borderRadius: 7}}>{x}</div>)}</aside>
          <main style={{padding: '22px 0', fontFamily: MONO, fontSize: 16, lineHeight: 1.82}}>
            <div style={{padding: '0 28px 15px', color: '#9aa096', borderBottom: `1px solid ${C.darkBorder}`}}>migration-retry.ts <span style={{color: '#f0a178'}}>M</span></div>
            <div style={{paddingTop: 18}}>
              {[
                [' ', '18', 'export async function runMigration(job: Job) {'],
                [' ', '19', '  const rollbackOwner = await getOwner(job);'],
                ['+', '20', '  if (!rollbackOwner) throw new SafetyStop("owner required");'],
                [' ', '21', ''],
                ['-', '22', '  return migrate(job);'],
                ['+', '23', '  return retry({ attempts: 3, backoff: "exponential" }, () =>'],
                ['+', '24', '    migrate(job, { abortOnErrorBudget: 0.003 })'],
                ['+', '25', '  );'],
                [' ', '26', '}'],
              ].map(([mark, n, line], i) => {
                const added = mark === '+';
                const removed = mark === '-';
                return <div key={n} style={{...reveal(local, 12 + i * 7, 12), display: 'grid', gridTemplateColumns: '26px 42px 1fr', padding: '0 24px', background: added ? 'rgba(46,160,100,.13)' : removed ? 'rgba(205,70,57,.12)' : 'transparent', color: added ? '#b8e7cd' : removed ? '#eeb7b1' : '#d6d9d1'}}><span style={{color: added ? '#65c894' : removed ? '#e0796f' : '#596058'}}>{mark}</span><span style={{color: '#5e655d'}}>{n}</span><span>{line || ' '}</span></div>;
              })}
            </div>
          </main>
          <aside style={{borderLeft: `1px solid ${C.darkBorder}`, background: '#11120f', padding: '24px 25px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 11}}><BrianMark size={40} /><div><div style={{fontSize: 16, fontWeight: 760}}>Brian safety check</div><div style={{fontFamily: MONO, color: '#7f877c', fontSize: 11, marginTop: 4}}>release-approval · v5</div></div></div>
            <div style={{marginTop: 24, display: 'grid', gap: 13}}>{[
              ['Rollback owner', 'Samir N.', true],
              ['Error budget', '0.12% / 0.3%', true],
              ['Release window', 'Tuesday · 10:00', true],
              ['Automated tests', testsDone ? '12 passed' : 'running…', testsDone],
            ].map(([k, v, ok], i) => <div key={String(k)} style={{...reveal(local, 30 + i * 12), borderRadius: 12, border: `1px solid ${C.darkBorder}`, padding: '13px 14px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8}}><span style={{fontSize: 13, color: '#8b9288'}}>{k}</span><span style={{fontFamily: MONO, fontSize: 12, color: ok ? '#70ce9d' : '#e6b56c'}}>{v}</span></div>)}</div>
            <div style={{...reveal(local, 112), marginTop: 22, background: '#090a08', borderRadius: 13, padding: 16, fontFamily: MONO, fontSize: 13, lineHeight: 1.7, color: '#a6ada2'}}><span style={{color: '#70ce9d'}}>$ npm test -- migration-retry</span><br />✓ retries transient failure<br />✓ stops without rollback owner<br />✓ respects error budget<br /><span style={{color: '#fff'}}>12 passed · 1.8s</span></div>
            <div style={{...reveal(local, 162), marginTop: 17, padding: '13px 17px', borderRadius: 11, background: '#2b8958', color: '#fff', textAlign: 'center', fontSize: 15, fontWeight: 760}}><Check size={16} />&nbsp; Open pull request</div>
          </aside>
        </div>
      </Window>
    </div>
  );
};

const ReceiptScene = () => {
  const frame = useCurrentFrame();
  const local = frame - 555;
  return (
    <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity(frame, 580, 660, 14), display: 'grid', placeItems: 'center'}}>
      <TopBrand label="Film 02 · execute" />
      <div style={{width: 1160, color: '#fff', textAlign: 'center'}}>
        <div style={{...reveal(local, 4), fontFamily: MONO, fontSize: 14, color: '#eaa178', textTransform: 'uppercase', letterSpacing: '.16em'}}>execution complete</div>
        <div style={{...reveal(local, 10), fontSize: 52, fontWeight: 800, letterSpacing: '-.045em', marginTop: 12}}>The work is done. The judgment is visible.</div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 30, textAlign: 'left'}}>{[
          ['Email', 'Sent in Sam’s tone', 'Gmail'],
          ['Code', '12 tests passed · PR opened', 'Cursor'],
          ['Audit', 'Skill v5 · evidence linked', 'Brian'],
        ].map(([k, v, m], i) => <div key={k} style={{...reveal(local, 18 + i * 7), borderRadius: 17, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.07)', padding: '20px 22px', display: 'grid', gridTemplateColumns: '44px 1fr', gap: 14, alignItems: 'center'}}><div style={{width: 42, height: 42, borderRadius: 13, background: i === 2 ? C.accent : 'rgba(255,255,255,.12)', display: 'grid', placeItems: 'center'}}><Check size={21} color="#fff" /></div><div><div style={{fontFamily: MONO, fontSize: 11, color: '#eaa178'}}>{m} · {k}</div><div style={{fontSize: 17, fontWeight: 700, marginTop: 6}}>{v}</div></div></div>)}</div>
      </div>
    </div>
  );
};

export const SkillExecution = () => (
  <AbsoluteFill>
    <FilmBackground>
      <BriefScene />
      <EmailScene />
      <CodeScene />
      <ReceiptScene />
    </FilmBackground>
  </AbsoluteFill>
);
