'use strict';

const echo = require('../utils/echo-response');
const Relaxation = require('../../index');
const test = require('ava');

const relax = new Relaxation({
    widgets: {
        fields: {
            bar: { inclusion: 'default' },
            bazz: {
                fields: {
                    plugh: { inclusion: 'default' },
                    waldo: true
                }
            },
            foo: true,
            id: { inclusion: 'always' },
            silly: { inclusion: 'always' }
        }
    }
}, {
    widgets: echo
});

test('GET resource list, first page, default fields', async t => {
    t.deepEqual(
        await relax.process({ method: 'GET', path: '/widgets' }),
        {
            status: 200,
            headers: {},
            body: {
                resources: [
                    {
                        bar: '/bar',
                        bazz: { plugh: '/bazz/plugh' },
                        id: '0',
                        silly: '/silly'
                    },
                    {
                        bar: '/bar',
                        bazz: { plugh: '/bazz/plugh' },
                        id: '1',
                        silly: '/silly'
                    },
                    {
                        bar: '/bar',
                        bazz: { plugh: '/bazz/plugh' },
                        id: '2',
                        silly: '/silly'
                    }
                ],
                next: '2',
                previous: '0'
            }
        }
    )
});

test('GET resource list, after page', async t => {
    t.deepEqual(
        await relax.process(
            { method: 'GET', path: '/widgets', queryString: 'after=2' }
        ),
        {
            status: 200,
            headers: {},
            body: {
                resources: [
                    {
                        bar: '/bar',
                        bazz: { plugh: '/bazz/plugh' },
                        id: '3',
                        silly: '/silly'
                    },
                    {
                        bar: '/bar',
                        bazz: { plugh: '/bazz/plugh' },
                        id: '4',
                        silly: '/silly'
                    },
                    {
                        bar: '/bar',
                        bazz: { plugh: '/bazz/plugh' },
                        id: '5',
                        silly: '/silly'
                    }
                ],
                next: '5',
                previous: '3'
            }
        }
    )
});
