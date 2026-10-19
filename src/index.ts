import { spawn } from 'spawn-but-with-promises';
import { setTimeout } from 'node:timers/promises'
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TIMEOUT = 600000;
const EXTRASPACE = new RegExp('\\s+', 'g');
const CHECKUPDATESCACHE = path.join(os.homedir(), '.cache', 'artix-checkupdates');
const fsp = fs.promises;

const NAMECOMPLIANCE = [
    (p: string): string => p.replace(/([a-zA-Z0-9]+)\+([a-zA-Z]+)/g, '$1-$2'),
    (p: string): string => p.replace(/\+/g, "plus"),
    (p: string): string => p.replace(/[^a-zA-Z0-9_\-\.]/g, "-"),
    (p: string): string => p.replace(/[_\-]{2,}/g, "-")
]

export type ArtixRepo = 'system' | 'system-gremlins' | 'system-goblins' | 'world' | 'world-gremlins' | 'world-goblins' | 'galaxy' | 'galaxy-gremlins' | 'galaxy-goblins' | 'lib32' | 'lib32-gremlins' | 'lib32-goblins';
export type ArchRepo = 'core' | 'core-testing' | 'core-staging' | 'extra' | 'extra-testing' | 'extra-staging' | 'multilib' | 'multilib-testing' | 'multilib-staging' | 'N/A';
export type ValidFlag = '-u' | '-m' | '-ml' | '-a' | '-d';

export interface CheckupdatesOptions {
    timeout?: number;
}

export interface CheckupdatesResult {
    basename: string;
    artixRepo: ArtixRepo;
    artixVersion: string;
    archRepo: ArchRepo;
    archVersion: string;
    packager: string;
}

export function applyCompliance(str: string) {
    return NAMECOMPLIANCE.reduce((s: string, fn): string => fn(s), str);
}

export class Checkupdates {
    private _timeout: number;

    constructor(options: CheckupdatesOptions = {}) {
        this._timeout = options.timeout || TIMEOUT;
    }

    async cleanUpLockfiles() {
        try {
            await fsp.rm(CHECKUPDATESCACHE, { recursive: true, force: true });
        }
        catch (ex) {
            console.error('Failed to remove the artix-checkupdates cache directory:', ex);
        }
    }

    private parseCheckUpdatesOutput(output: string, doApplyCompliance: boolean = false) {
        const packages: CheckupdatesResult[] = [];
        const lines = output.split('\n');
        lines.forEach(l => {
            // "package" is "reserved"
            const reservethis = l.trim().replace(EXTRASPACE, ' ');
            if (reservethis.length > 0 && reservethis.indexOf('Package basename') < 0) {
                const cols = reservethis.split(' ');
                const basename = cols[0] || '';
                packages.push({
                    basename: doApplyCompliance ? applyCompliance(basename) : basename,
                    artixRepo: cols[1] as ArtixRepo,
                    artixVersion: cols[2] || '',
                    archRepo: cols[3] as ArchRepo,
                    archVersion: cols[4] as ArchRepo,
                    packager: cols[5] || ''
                });
            }
        });
        return packages;
    }

    private async checkupdates(flag: ValidFlag, doApplyCompliance: boolean = false) {
        const process = spawn('artix-checkupdates', [flag]);
        const outputstr: string[] = [];
        const errorOutput: string[] = [];
        process.stdout.on('data', data => {
            outputstr.push(data.toString());
        });
        process.stderr.on('data', err => {
            const errstr = err.toString();
            errorOutput.push(errstr);
            console.error(errstr);
        });

        await Promise.race([setTimeout(this._timeout), process]);
        if (process.exitCode === null) {
            process.kill();
            throw new Error(`artix-checkupdates timed out after ${this._timeout}ms`);
        }
        else if (errorOutput.length !== 0) {
            errorOutput.includes('unable to lock database') && this.cleanUpLockfiles();
            throw new Error(errorOutput.join(', '));
        }
        else if (process.exitCode !== 0) {
            throw new Error(`artix-checkupdates returned exit code ${process.exitCode}`);
        }
        return this.parseCheckUpdatesOutput(outputstr.join(''), doApplyCompliance);
    }

    private async retryCheckupdates(flag: ValidFlag, doApplyCompliance: boolean = false, retries: number = 1, pause: number = 2300) {
        let tries = 0;
        while (retries > tries++) {
            try {
                return await this.checkupdates(flag, doApplyCompliance);
            }
            catch {
                console.error(`artix-checkupdates failed ${tries} time(s). Retrying...`);
                await setTimeout(pause);
            }
        }
        return await this.checkupdates(flag, doApplyCompliance);
    }

    fetchUpgradable(doApplyCompliance: boolean = false, retries: number = 0) {
        return this.retryCheckupdates('-u', doApplyCompliance, retries);
    }

    fetchDowngrades(doApplyCompliance: boolean = false, retries: number = 0) {
        return this.retryCheckupdates('-d', doApplyCompliance, retries);
    }

    fetchMovable(doApplyCompliance: boolean = false, retries: number = 0) {
        return this.retryCheckupdates('-m', doApplyCompliance, retries);
    }

    fetchLooseMovable(doApplyCompliance: boolean = false, retries: number = 0) {
        return this.retryCheckupdates('-ml', doApplyCompliance, retries);
    }

    fetchArtixOnly(doApplyCompliance: boolean = false, retries: number = 0) {
        return this.retryCheckupdates('-a', doApplyCompliance, retries);
    }
}

export default Checkupdates;
