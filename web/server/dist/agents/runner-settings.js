import { enabledRunners, resolveRunnerChoice, saveConfigFields } from '../config.js';
import { RUNNER_CHOICES, hireableRunners } from '../protocol.js';
export function runnerSettings(cfg) {
    return { runner: resolveRunnerChoice(cfg), enabledRunners: enabledRunners(cfg) };
}
/**
 * Turns one agent on or off, and saves it. Turning the default off moves the
 * default to another agent that is on and ready; with none, the default stays
 * and the hire panel asks Operator to set one up. Turning one on while the default
 * is off makes it the default.
 */
export function setRunnerEnabled(cfg, id, on, runners) {
    const before = enabledRunners(cfg);
    const enabled = RUNNER_CHOICES.filter((r) => (r === id ? on : before.includes(r)));
    let runner = resolveRunnerChoice(cfg);
    if (!enabled.includes(runner)) {
        runner = on ? id : (hireableRunners(enabled, runners)[0] ?? runner);
    }
    save(cfg, runner, enabled);
    return { runner, enabledRunners: enabled };
}
/** Makes an agent the default for new hires, turning it on: onboarding sets up the agent Operator picked. */
export function chooseRunner(cfg, id) {
    const before = enabledRunners(cfg);
    const enabled = RUNNER_CHOICES.filter((r) => r === id || before.includes(r));
    save(cfg, id, enabled, true);
    return { runner: id, enabledRunners: enabled };
}
/**
 * An office from before the enabled list has none saved: once every agent has
 * been checked, turn on the ones that passed, and the default, so nothing
 * Operator used goes missing. Returns whether it set the list.
 */
export function adoptEnabledRunners(cfg, runners) {
    if (Array.isArray(cfg.agents.enabledRunners))
        return false;
    if (RUNNER_CHOICES.some((id) => runners[id].status === 'checking'))
        return false;
    const runner = resolveRunnerChoice(cfg);
    const enabled = RUNNER_CHOICES.filter((id) => id === runner || runners[id].status === 'ok');
    cfg.agents.enabledRunners = enabled;
    saveConfigFields('agents', { enabledRunners: enabled });
    return true;
}
function save(cfg, runner, enabled, pick = false) {
    const changed = pick || resolveRunnerChoice(cfg) !== runner;
    cfg.agents.enabledRunners = enabled;
    if (changed)
        cfg.agents.runnerMode = runner;
    saveConfigFields('agents', changed ? { enabledRunners: enabled, runnerMode: runner } : { enabledRunners: enabled });
}
