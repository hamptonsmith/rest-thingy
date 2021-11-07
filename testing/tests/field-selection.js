'use strict';

const jsonpointer = require('jsonpointer');
const Relaxation = require('../../index');
const test = require('ava');

function echoMiddleware(ctx, next) {
    ctx.response.status = 200;

    function fillArrayLevel(target, request) {
        for (const [key, value] of Object.entries(request)) {
            if (value === true) {
                jsonpointer.set(target, key, key);
            }
            else {
                const nextLevel = {};
                jsonpointer.set(target, key, [nextLevel]);
                fillArrayLevel(nextLevel, value);
            }
        }

        target.extra = 'something extra';
    }

    ctx.response.body = {};
    fillArrayLevel(ctx.response.body, ctx.request.fieldsArrayStructure);
}

test('GET top level resource, default fields', async t => {
    const relax = new Relaxation({
        widgets: {
            fields: {
                bar: {
                    fields: {
                        bazz: {
                            array: true,
                            fields: {
                                plugh: {
                                    fields: {
                                        waldo: {
                                            inclusion: 'default'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    relax.use(echoMiddleware);

    t.deepEqual(
        await relax.process({ method: 'GET', path: '/widgets/w1' }),
        {
            status: 200,
            body: {
                bar: {
                    bazz: [
                        {
                            plugh: { waldo: '/plugh/waldo' }
                        }
                    ]
                }
            }
        }
    );
});
