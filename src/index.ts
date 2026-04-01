import { spawn } from 'spawn-but-with-promises';
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
export type ArchRepo = 'core' | 'core-testing' | 'core-staging' | 'extra' | 'extra-testing' | 'extra-staging' | 'multilib' | 'multilib-testing' | 'multilib-staging';

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

    applyCompliance(str: string): string {
        return NAMECOMPLIANCE.reduce((s: string, fn): string => fn(s), str);
    }

    parseCheckUpdatesOutput(output: string, applyCompliance: boolean = false): CheckupdatesResult[] {
        const packages: CheckupdatesResult[] = [];
        const lines = output.split('\n');
        lines.forEach(l => {
            // "package" is "reserved"
            const reservethis = l.trim().replace(EXTRASPACE, ' ');
            if (reservethis.length > 0 && reservethis.indexOf('Package basename') < 0) {
                const cols = reservethis.split(' ');
                const basename = cols[0] || '';
                packages.push({
                    basename: applyCompliance ? this.applyCompliance(basename) : basename,
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

    async checkupdates(flag: '-u' | '-m' | '-ml', applyCompliance: boolean = false): Promise<CheckupdatesResult[]> {
        const process = spawn('artix-checkupdates', [flag]);
        const to = setTimeout(async () => {
            process.kill() && await this.cleanUpLockfiles();
            throw new Error('Timed out');
        }, this._timeout);
        let outputstr = '';
        let errorOutput = '';
        process.stdout.on('data', data => {
            outputstr += data.toString();
        });
        process.stderr.on('data', err => {
            const errstr = err.toString();
            errorOutput += `${errstr}, `;
            console.error(errstr);
        });
        const code = await process;
        clearTimeout(to);
        if (code !== 0 || errorOutput.length !== 0) {
            errorOutput.includes('unable to lock database') && this.cleanUpLockfiles();
            throw new Error((code && `exited with ${code}`) || errorOutput)
        }
        else {
            return this.parseCheckUpdatesOutput(outputstr, applyCompliance);
        }
    }

    fetchUpgradable(applyCompliance: boolean = false): Promise<CheckupdatesResult[]> {
        return this.checkupdates('-u', applyCompliance);
    }

    fetchMovable(applyCompliance: boolean = false): Promise<CheckupdatesResult[]> {
        return this.checkupdates('-m', applyCompliance);
    }

    fetchLooseMovable(applyCompliance: boolean = false): Promise<CheckupdatesResult[]> {
        return this.checkupdates('-ml', applyCompliance);
    }
}

export default Checkupdates;
