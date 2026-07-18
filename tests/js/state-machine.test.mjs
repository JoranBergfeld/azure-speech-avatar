import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMachine, States, Events } from '../../src/Api/wwwroot/js/state-machine.js';

test('start connects, connected begins listening', () => {
  const m = createMachine();
  m.dispatch(Events.Start);
  assert.equal(m.state.name, States.Connecting);
  m.dispatch(Events.Connected);
  assert.equal(m.state.name, States.Listening);
});

test('recognized -> thinking -> speaking -> back to listening', () => {
  const m = createMachine({ name: States.Listening, muted: false });
  m.dispatch(Events.Recognized);
  assert.equal(m.state.name, States.Thinking);
  m.dispatch(Events.ReplyReady);
  assert.equal(m.state.name, States.Speaking);
  m.dispatch(Events.SynthesisComplete);
  assert.equal(m.state.name, States.Listening);
});

test('reply failure is an explicit error state', () => {
  const m = createMachine({ name: States.Thinking, muted: false });
  m.dispatch(Events.ReplyFailed);
  assert.equal(m.state.name, States.Error);
  m.dispatch(Events.GiveUp);
  assert.equal(m.state.name, States.Idle);
});

test('mute is sticky: finishing speech while muted goes to Muted, not Listening', () => {
  const m = createMachine({ name: States.Speaking, muted: false });
  m.dispatch(Events.MuteOn);
  m.dispatch(Events.SynthesisComplete);
  assert.equal(m.state.name, States.Muted);
  m.dispatch(Events.MuteOff);
  assert.equal(m.state.name, States.Listening);
});

test('connecting failure -> error', () => {
  const m = createMachine({ name: States.Connecting, muted: false });
  m.dispatch(Events.ConnectFailed);
  assert.equal(m.state.name, States.Error);
});

test('idle timeout while listening returns to idle', () => {
  const m = createMachine({ name: States.Listening, muted: false });
  m.dispatch(Events.IdleTimeout);
  assert.equal(m.state.name, States.Idle);
});
