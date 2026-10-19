import { rm } from 'fs/promises';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { setTimeout } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkupdates } from '../src/index.js';
import { spawn, type ChildProcessWithoutNullStreamsAndPromise } from 'spawn-but-with-promises';

interface ProcProperties {
    exitCode: number | null;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
}

class FakeSpawn {
    private _resolvePromise: (value: number) => void;
    private _rejectPromise: (value: string | Error) => void;
    private _proc: Promise<number> & ProcProperties;
    private _stdOut: EventEmitter;
    private _stdErr: EventEmitter;
    private _killed: boolean;

    constructor() {
        this._killed = false;
        const proc: Promise<number> & Partial<ProcProperties> = new Promise((resolve, reject) => {
            this._resolvePromise = resolve;
            this._rejectPromise = reject;
        });
        proc.exitCode = null;
        proc.stdout = this._stdOut = new EventEmitter();
        proc.stderr = this._stdErr = new EventEmitter();
        proc.kill = () => {
            this._killed = true;
            this.resolvePromise(1);
        };
        this._proc = proc as any;
    }

    wasKilled() {
        return this._killed;
    }

    getProc() {
        return this._proc as unknown as ChildProcessWithoutNullStreamsAndPromise;
    }

    resolvePromise(val: number) {
        this._proc.exitCode = val;
        this._resolvePromise(val);
    }

    rejectPromise(err: string | Error, exitCode: number = -1) {
        if (exitCode >= 0) {
            this._proc.exitCode = exitCode;
        }
        this._rejectPromise(err)
    }

    emitStdout(data: string) {
        this._stdOut.emit('data', data);
    }

    emitStderr(data: string) {
        this._stdErr.emit('data', data);
    }
}

class FakePromise<T> {
    private _resolvePromise: () => void;
    private _rejectPromise: (val: T) => void;
    private _promise: Promise<void>;
    constructor() {
        this._promise = new Promise((resolve, reject) => {
            this._resolvePromise = resolve;
            this._rejectPromise = reject;
        });
    }

    getPromise() {
        return this._promise;
    }

    resolvePromise() {
        this._resolvePromise();
    }

    rejectPromise(val: T) {
        this._rejectPromise(val);
    }
}

type FunctionName = 'Artix-only' | 'downgrades' | 'movable' | 'loose movable' | 'upgradable';

const FN_ARTIX_ONLY: FunctionName = 'Artix-only';
const FN_DOWNGRADES: FunctionName = 'downgrades';
const FN_MOVABLE: FunctionName = 'movable';
const FN_LOOSE_MOVABLE: FunctionName = 'loose movable';
const FN_UPGRADABLE: FunctionName = 'upgradable';
const FLAGS_BY_FUNCTION_NAME: Record<FunctionName, string> = {
    [FN_ARTIX_ONLY]: '-a',
    [FN_DOWNGRADES]: '-d',
    [FN_MOVABLE]: '-m',
    [FN_LOOSE_MOVABLE]: '-ml',
    [FN_UPGRADABLE]: '-u'
};
const RESOURCE_DIR = join('test', 'resources');

vi.mock(import('spawn-but-with-promises'), () => ({
    spawn: vi.fn()
}));

vi.mock(import('node:timers/promises'), () => ({
    setTimeout: vi.fn()
}));

vi.mock(import('fs/promises'), () => ({
    rm: vi.fn()
}));

function callFetch(params: { funcName: FunctionName, doApplyCompliance?: boolean, retries?: number, timeout?: number }) {
    const doApplyCompliance = params.doApplyCompliance ?? false;
    const retries = params.retries ?? 0;
    const checkupdates = new Checkupdates({
        timeout: params.timeout
    });
    switch (params.funcName) {
        case FN_ARTIX_ONLY:
            return checkupdates.fetchArtixOnly(doApplyCompliance, retries);
        case FN_DOWNGRADES:
            return checkupdates.fetchDowngrades(doApplyCompliance, retries);
        case FN_MOVABLE:
            return checkupdates.fetchMovable(doApplyCompliance, retries);
        case FN_LOOSE_MOVABLE:
            return checkupdates.fetchLooseMovable(doApplyCompliance, retries);
        case FN_UPGRADABLE:
            return checkupdates.fetchUpgradable(doApplyCompliance, retries);
        default:
            throw new Error(`No function matches ${params.funcName}`);
    }
}

describe('Checkupdates wrapper', () => {

    afterEach(() => {
        vi.mocked(spawn).mockRestore();
        vi.mocked(setTimeout).mockRestore();
        vi.mocked(rm).mockRestore();
    });

    it.each`
            func                | inputFile                            | expectedFile
            ${FN_ARTIX_ONLY}    | ${join('artixOnly', 'real.json')}    | ${join('artixOnly', 'real.parsed.json')}
            ${FN_DOWNGRADES}    | ${join('downgrades', 'real.json')}   | ${join('downgrades', 'real.parsed.json')}
            ${FN_MOVABLE}       | ${join('movable', 'real.json')}      | ${join('movable', 'real.parsed.json')}
            ${FN_LOOSE_MOVABLE} | ${join('looseMovable', 'real.json')} | ${join('looseMovable', 'real.parsed.json')}
            ${FN_UPGRADABLE}    | ${join('upgradable', 'real.json')}   | ${join('upgradable', 'real.parsed.json')}
        `('fetches $func packages with input from $inputFile', async (params: { func: FunctionName, inputFile: string, expectedFile: string }) => {
        const input = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, params.inputFile), { encoding: 'utf-8' })) as string[];
        const expected = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, params.expectedFile), { encoding: 'utf-8' })) as string[];

        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());

        const result = callFetch({ funcName: params.func });

        input.forEach(data => {
            fakeSpawn.emitStdout(data);
        });
        fakeSpawn.resolvePromise(0);
        await expect(result).resolves.toStrictEqual(expected);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[params.func]]);
        expect(fakeSpawn.wasKilled()).toBe(false);
    });

    it.each`
            func                | timeout
            ${FN_ARTIX_ONLY}    | ${10}
            ${FN_DOWNGRADES}    | ${20}
            ${FN_MOVABLE}       | ${15}
            ${FN_LOOSE_MOVABLE} | ${5}
            ${FN_UPGRADABLE}    | ${1}
        `('throws an error if timeout is exceeded while calling $func', async (params: { func: FunctionName, timeout: number }) => {
        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());

        const result = callFetch({
            funcName: params.func,
            timeout: params.timeout
        });

        await expect(result).rejects.toThrow(`artix-checkupdates returned exit code 1`);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[params.func]]);
        expect(fakeSpawn.wasKilled()).toBe(true);
    });

    it.each`
            func                | exit
            ${FN_ARTIX_ONLY}    | ${1}
            ${FN_DOWNGRADES}    | ${22}
            ${FN_MOVABLE}       | ${255}
            ${FN_LOOSE_MOVABLE} | ${37}
            ${FN_UPGRADABLE}    | ${55}
        `('throws an error if child process exits with code $exit when fetching $func', async (params: { func: FunctionName, exit: number }) => {
        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());

        const result = callFetch({ funcName: params.func });

        fakeSpawn.resolvePromise(params.exit);

        await expect(result).rejects.toThrow(`artix-checkupdates returned exit code ${params.exit}`);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[params.func]]);
        expect(fakeSpawn.wasKilled()).toBe(false);
    });

    it.each`
            func                | stderr
            ${FN_ARTIX_ONLY}    | ${'ERROR'}
            ${FN_DOWNGRADES}    | ${'Ouch!'}
            ${FN_MOVABLE}       | ${'something went wrong'}
            ${FN_LOOSE_MOVABLE} | ${'oh no!'}
            ${FN_UPGRADABLE}    | ${'ope, that\'s not right'}
        `('throws an error if child process writes to stderr when fetching $func', async (params: { func: FunctionName, stderr: string }) => {
        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());

        const result = callFetch({ funcName: params.func });

        fakeSpawn.emitStderr(params.stderr);
        fakeSpawn.resolvePromise(0);

        await expect(result).rejects.toThrow(params.stderr);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[params.func]]);
        expect(fakeSpawn.wasKilled()).toBe(false);
    });

    it('retries on failure', async () => {
        const { setTimeout: setTO } = await vi.importActual<typeof import('node:timers/promises')>('node:timers/promises');
        const input = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, 'upgradable', 'real.json'), { encoding: 'utf-8' })) as string[];
        const expected = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, 'upgradable', 'real.parsed.json'), { encoding: 'utf-8' })) as string[];
        const errSpawn = new FakeSpawn();
        const successSpawn = new FakeSpawn();
        const timeoutToResolve = new FakePromise();
        vi.mocked(spawn).mockReturnValueOnce(errSpawn.getProc()).mockReturnValueOnce(successSpawn.getProc());
        vi.mocked(setTimeout).mockReturnValueOnce(timeoutToResolve.getPromise());

        const result = callFetch({ funcName: FN_UPGRADABLE, retries: 5 });

        errSpawn.resolvePromise(1);
        timeoutToResolve.resolvePromise();
        await setTO(50);
        input.forEach(data => {
            successSpawn.emitStdout(data);
        });
        successSpawn.resolvePromise(0);

        await expect(result).resolves.toStrictEqual(expected);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[FN_UPGRADABLE]]);
        expect(errSpawn.wasKilled()).toBe(false);
        expect(successSpawn.wasKilled()).toBe(false);
    });

    it('returns url-compliant package names', async () => {
        const input = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, 'upgradable', 'noncompliant.json'), { encoding: 'utf-8' })) as string[];
        const expected = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, 'upgradable', 'noncompliant.parsed.json'), { encoding: 'utf-8' })) as string[];
        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());

        const result = callFetch({ funcName: FN_UPGRADABLE, doApplyCompliance: true });

        input.forEach(data => {
            fakeSpawn.emitStdout(data);
        });
        fakeSpawn.resolvePromise(0);
        await expect(result).resolves.toStrictEqual(expected);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[FN_UPGRADABLE]]);
        expect(fakeSpawn.wasKilled()).toBe(false);
    });

    it.each`
            rmRejects
            ${false}
            ${true}
    `('removes cache if process reports it can\'t lock database', async (params: { rmRejects: boolean }) => {
        const errMsg = 'unable to lock database';
        const fakeSpawn = new FakeSpawn();
        const fakeRm = new FakePromise<string>();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());
        vi.mocked(setTimeout).mockReturnValue((new FakePromise()).getPromise());
        vi.mocked(rm).mockReturnValue(fakeRm.getPromise());

        const result = callFetch({ funcName: FN_UPGRADABLE });

        fakeSpawn.emitStderr(errMsg);
        fakeSpawn.resolvePromise(0);
        if (params.rmRejects) {
            fakeRm.rejectPromise('unit test');
        }
        else {
            fakeRm.resolvePromise();
        }

        await expect(result).rejects.toThrow(errMsg);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[FN_UPGRADABLE]]);
        expect(fakeSpawn.wasKilled()).toBe(false);
        expect(rm).toHaveBeenCalledWith(join(homedir(), '.cache', 'artix-checkupdates'), { "force": true, "recursive": true });
    });
});
