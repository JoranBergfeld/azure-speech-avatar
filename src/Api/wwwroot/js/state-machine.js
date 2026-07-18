export const States = Object.freeze({
  Idle: 'idle',
  Connecting: 'connecting',
  Listening: 'listening',
  Thinking: 'thinking',
  Speaking: 'speaking',
  Muted: 'muted',
  Error: 'error',
});

export const Events = Object.freeze({
  Start: 'start',
  Connected: 'connected',
  ConnectFailed: 'connectFailed',
  Recognized: 'recognized',
  IdleTimeout: 'idleTimeout',
  ReplyReady: 'replyReady',
  ReplyFailed: 'replyFailed',
  SynthesisComplete: 'synthesisComplete',
  MuteOn: 'muteOn',
  MuteOff: 'muteOff',
  RetrySucceeded: 'retrySucceeded',
  GiveUp: 'giveUp',
  Stop: 'stop',
});

/**
 * Pure half-duplex turn-taking machine. State = { name, muted }.
 * `muted` is tracked independently so it can stay sticky across turns.
 */
export function createMachine(initial = { name: States.Idle, muted: false }) {
  let state = { ...initial };
  const listeners = [];

  function set(next) {
    state = next;
    for (const l of listeners) l(state);
  }

  // Where to go when the mic could resume: Listening unless the user muted.
  function resumeTarget(muted) {
    return muted ? States.Muted : States.Listening;
  }

  function dispatch(event) {
    const { name, muted } = state;
    switch (event) {
      case Events.MuteOn:
        set({ name, muted: true });
        break;
      case Events.MuteOff:
        set({ name: name === States.Muted ? States.Listening : name, muted: false });
        break;
      case Events.Start:
        if (name === States.Idle) set({ name: States.Connecting, muted });
        break;
      case Events.Connected:
        if (name === States.Connecting) set({ name: resumeTarget(muted), muted });
        break;
      case Events.ConnectFailed:
        if (name === States.Connecting) set({ name: States.Error, muted });
        break;
      case Events.Recognized:
        if (name === States.Listening) set({ name: States.Thinking, muted });
        break;
      case Events.IdleTimeout:
        if (name === States.Listening) set({ name: States.Idle, muted });
        break;
      case Events.ReplyReady:
        if (name === States.Thinking) set({ name: States.Speaking, muted });
        break;
      case Events.ReplyFailed:
        if (name === States.Thinking) set({ name: States.Error, muted });
        break;
      case Events.SynthesisComplete:
        if (name === States.Speaking) set({ name: resumeTarget(muted), muted });
        break;
      case Events.RetrySucceeded:
        if (name === States.Error) set({ name: resumeTarget(muted), muted });
        break;
      case Events.GiveUp:
        if (name === States.Error) set({ name: States.Idle, muted });
        break;
      case Events.Stop:
        set({ name: States.Idle, muted });
        break;
      default:
        break;
    }
    return state;
  }

  return {
    get state() { return state; },
    dispatch,
    subscribe(fn) {
      listeners.push(fn);
      return () => listeners.splice(listeners.indexOf(fn), 1);
    },
  };
}
