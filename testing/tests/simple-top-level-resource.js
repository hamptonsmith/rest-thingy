'use strict';

const jsonpointer = require('jsonpointer');
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
});

relax.use((ctx, next) => {
    ctx.response.status = 200;
    ctx.response.body = {};

    for (const requestedField of ctx.request.fields) {
        jsonpointer.set(ctx.response.body, requestedField, requestedField);
    }

    ctx.response.body.id = ctx.request.resource[0].id;
    ctx.response.body.extra = 'something extra';
});

test('GET top level resource, default fields', async t => {
    t.deepEqual(
        await relax.process({ method: 'GET', path: '/widgets/w1' }),
        {
            status: 200,
            body: {
                bar: '/bar',
                bazz: { plugh: '/bazz/plugh' },
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, no fields', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f='
        }),
        {
            status: 200,
            body: {
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, single explicit field', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f=foo'
        }),
        {
            status: 200,
            body: {
                foo: '/foo',
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, single nested field, dot syntax', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f=bazz.plugh'
        }),
        {
            status: 200,
            body: {
                bazz: { plugh: '/bazz/plugh' },
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, single nested field, JSON syntax', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString:
                    'f=' + encodeURIComponent(JSON.stringify(['bazz', 'plugh']))
        }),
        {
            status: 200,
            body: {
                bazz: { plugh: '/bazz/plugh' },
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, multi-field, single query entry', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f='
                    + 'bar,bazz.plugh,'
                    + encodeURIComponent(JSON.stringify(['bazz', 'waldo']))
                    + ',foo'
        }),
        {
            status: 200,
            body: {
                bar: '/bar',
                bazz: {
                    plugh: '/bazz/plugh',
                    waldo: '/bazz/waldo'
                },
                foo: '/foo',
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, multi-field, multiple query entries', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f='
                    + 'bar&f=bazz.plugh,'
                    + encodeURIComponent(JSON.stringify(['bazz', 'waldo']))
                    + '&f=foo'
        }),
        {
            status: 200,
            body: {
                bar: '/bar',
                bazz: {
                    plugh: '/bazz/plugh',
                    waldo: '/bazz/waldo'
                },
                foo: '/foo',
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, multi-field is alphabetized', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f='
                    + encodeURIComponent(JSON.stringify(['bazz', 'waldo']))
                    + ',foo,bar,bazz.plugh'
        }),
        {
            status: 200,
            body: {
                bar: '/bar',
                bazz: {
                    plugh: '/bazz/plugh',
                    waldo: '/bazz/waldo'
                },
                foo: '/foo',
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});

test('GET top level resource, unknown field not propagated', async t => {
    t.deepEqual(
        await relax.process({
            method: 'GET',
            path: '/widgets/w1',
            queryString: 'f=bazz.plugh,bazz.notathing,foo'
        }),
        {
            status: 200,
            body: {
                bazz: { plugh: '/bazz/plugh' },
                foo: '/foo',
                id: 'w1',
                silly: '/silly'
            }
        }
    );
});
