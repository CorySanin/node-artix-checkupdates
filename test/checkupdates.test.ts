import fsp from 'fs/promises';
import { join } from 'path';
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

class FakeTimeout {
    private _resolvePromise: () => void;
    private _promise: Promise<void>;
    constructor() {
        this._promise = new Promise((resolve) => {
            this._resolvePromise = resolve;
        });
    }

    getPromise() {
        return this._promise;
    }

    resolvePromise() {
        this._resolvePromise();
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
}))

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
    });

    it.each`
            func                | inputFile                            | expectedFile
            ${FN_ARTIX_ONLY}    | ${join('artixOnly', 'real.json')}    | ${join('artixOnly', 'real.parsed.json')}
            ${FN_DOWNGRADES}    | ${join('downgrades', 'real.json')}   | ${join('downgrades', 'real.parsed.json')}
            ${FN_MOVABLE}       | ${join('movable', 'real.json')}      | ${join('movable', 'real.parsed.json')}
            ${FN_LOOSE_MOVABLE} | ${join('looseMovable', 'real.json')} | ${join('looseMovable', 'real.parsed.json')}
            ${FN_UPGRADABLE}    | ${join('upgradable', 'real.json')}   | ${join('upgradable', 'real.parsed.json')}
        `('can fetch $func packages with input from $inputFile', async (params: { func: FunctionName, inputFile: string, expectedFile: string }) => {
        const input = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, params.inputFile), { encoding: 'utf-8' })) as string[];
        const expected = JSON.parse(await fsp.readFile(join(RESOURCE_DIR, params.expectedFile), { encoding: 'utf-8' })) as string[];

        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());
        vi.mocked(setTimeout).mockReturnValue((new FakeTimeout).getPromise());

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
            ${FN_ARTIX_ONLY}    | ${600000}
            ${FN_DOWNGRADES}    | ${300000}
            ${FN_MOVABLE}       | ${123456}
            ${FN_LOOSE_MOVABLE} | ${1001}
            ${FN_UPGRADABLE}    | ${9825}
        `('throws an error if timeout resolves when calling $func', async (params: { func: FunctionName, timeout: number }) => {
        const fakeTimeout = new FakeTimeout();
        const fakeSpawn = new FakeSpawn();
        vi.mocked(spawn).mockReturnValue(fakeSpawn.getProc());
        vi.mocked(setTimeout).mockReturnValue(fakeTimeout.getPromise());

        const result = callFetch({
            funcName: params.func,
            timeout: params.timeout === 600000 ? undefined : params.timeout
        });

        fakeTimeout.resolvePromise();
        await expect(result).rejects.toThrow(`artix-checkupdates timed out after ${params.timeout}ms`);
        expect(spawn).toHaveBeenCalledWith('artix-checkupdates', [FLAGS_BY_FUNCTION_NAME[params.func]]);
        expect(fakeSpawn.wasKilled()).toBe(true);
    });
});