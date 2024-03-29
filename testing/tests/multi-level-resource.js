'use strict';

const echo = require('../utils/echo-response');
const Relaxation = require('../../index');
const test = require('ava');

test('GET multi-level', async t => {
    const relax = new Relaxation({
        collections: {
            resources: {
                widgets: {
                    fields: {
                        collectionsId: { inclusion: 'default' },
                        foo: { inclusion: 'default' },
                        id: { inclusion: 'default' }
                    }
                }
            }
        }
    }, {
        collections: echo,
        widgets: echo
    });

    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/collections/c1/widgets/w1'
        }),
        {
            status: 200,
            headers: {},
            body: {
                collectionsId: 'c1',
                foo: '/foo',
                id: 'w1'
            }
        }
    )
});

test('GET multi-level with shared def', async t => {
    const relax = new Relaxation({
        collections: {
            resources: {
                widgets: { $ref: '/widgets' }
            }
        },
        widgets: {
            fields: {
                collectionsId: { inclusion: 'default' },
                foo: { inclusion: 'default' },
                id: { inclusion: 'default' }
            }
        }
    }, {
        collections: echo,
        widgets: echo
    });

    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/collections/c1/widgets/w1'
        }),
        {
            status: 200,
            headers: {},
            body: {
                collectionsId: 'c1',
                foo: '/foo',
                id: 'w1'
            }
        }
    )
});
