import { describe, expect, it } from 'vitest';
import { Checkupdates, applyCompliance } from '../src/index.js';


describe('applyCompliance() function', () => {
    it.each`
        input | expected
        ${'png++'} | ${'pngplusplus'}
        ${'c++utilities'} | ${'cplusplusutilities'}
        ${'memtest+'} | ${'memtestplus'}
    `('can parse package names with plus characters such as $input', (params: { input: string, expected: string }) => {
        expect(applyCompliance(params.input)).to.be.equal(params.expected);
    });

    it.each`
        input | expected
        ${'a+b'} | ${'a-b'}
    `('can parse package names with plus separators such as $input', (params: { input: string, expected: string }) => {
        expect(applyCompliance(params.input)).to.be.equal(params.expected);
    });

    it.each`
        input | expected
        ${'cool sdk'} | ${'cool-sdk'}
        ${'r&b'} | ${'r-b'}
    `('can parse package names with non-standard characters such as $input', (params: { input: string, expected: string }) => {
        expect(applyCompliance(params.input)).to.be.equal(params.expected);
    });

    it.each`
        input | expected
        ${'c--'} | ${'c-'}
        ${'dummy__package'} | ${'dummy-package'}
        ${'weird_-package'} | ${'weird-package'}
        ${'weird-_package'} | ${'weird-package'}
    `('can parse package names with two consecutive horizontal line characters such as $input', (params: { input: string, expected: string }) => {
        expect(applyCompliance(params.input)).to.be.equal(params.expected);
    });

    it.each`
        input
        ${'artix-metro'}
        ${'webrtc-audio-processing-0.3'}
        ${'firefox-i18n'}
        ${'fast_float'}
    `('passes $input through with no changes', (params: { input: string}) => {
        expect(applyCompliance(params.input)).to.be.equal(params.input);
    });
});
