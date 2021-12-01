'use strict';

const echo = require('../utils/echo-response');
const Relaxation = require('../../index');
const test = require('ava');
/*
test('GET rootlinks', async t => {
    const relax = new Relaxation({
        foo: {
            fields: {
                fooField: true
            }
        },
        bar: {
            id: 'notbar',
            fields: {
                barField: true
            }
        },
        bazz: {
            fields: {
                bazzField: true
            }
        }
    }, {});

    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/r8nschema'
        }),
        {
            status: 200,
            headers: {},
            body: {
                rootLinks: [
                    { link: 'foo', type: 'foo' },
                    { link: 'bar', type: 'notbar' },
                    { link: 'bazz', type: 'bazz' },
                    { link: 'r8nschema', type: 'r8nschema' }
                ]
            }
        }
    )
});
*/
test('GET resourceTypes', async t => {
    const relax = new Relaxation({
        foo: {
            fields: {
                fooField: true
            }
        },
        bar: {
            id: 'notbar',
            fields: {
                barField: true
            }
        },
        bazz: {
            fields: {
                bazzField: true
            }
        }
    }, {});

    console.log(JSON.stringify(await relax.process({
        method: 'GET',
        path: '/r8nschema/types'
    }), null, 4));

    const expectedResources = [
        {
            id: 'foo',
            links: {},
            fields: { fooField: true }
        },
        {
            id: 'notbar',
            links: {},
            fields: { barField: true }
        },
        {
            id: 'bazz',
            links: {},
            fields: { bazzField: true }
        },
        {
            id: 'r8nschema',
            links: { types: 'r8nschema.types' },
            fields: {
                rootLinks: { inclusion: 'default' }
            }
        },
        {
            id: 'r8nschema.types',
            links: {},
            fields: {
                fields: { inclusion: 'default' },
                id: { inclusion: 'default' },
                links: { inclusion: 'default' }
            }
        }
    ];

    const result = await relax.process({
        method: 'GET',
        path: '/r8nschema/types'
    });

    t.is(result.status, 200)
    t.deepEqual(result.headers, {});

    const resources = result.body.resources.reduce((accum, val) => {
        accum[val.id] = val;
        return accum;
    }, {});

    for (const expected of expectedResources) {
        if (!resources[expected.id]) {
            t.fail('Expected a resource with id: ' + expected.id);
        }

        t.deepEqual(resources[expected.id], expected,
                'resource ' + expected.id + ' as expected');
        delete resources[expected.id];
    }

    if (Object.keys(resources).length > 0) {
        t.fail('Unexpected resources: ' + Object.keys(resources));
    }
});
