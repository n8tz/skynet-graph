/**
 * Copyright (C) 2021  Nathanael Braun
 
 * @author Nathanael BRAUN
 *
 * Date: 19/01/2016
 * Time: 18:42
 */
var isArray  = require('is').array;
var debug  = console;
// var cutils   = require('../../TimingUtils');

var conceptLib = {};

function Concept( _, graph, parent ) {
    this.init(_, graph, parent);
};

// @todo mk a true require-produce mapping


Concept.prototype = {
    _static       : Concept,
    /**
     * Init & mount child concepts
     * @param record
     * @param graph
     * @param parent
     */
    init          : function ( record, graph, parent ) {
        var me      = this,
            cKeys   = record.childConcepts && Object.keys(record.childConcepts) || [],
            asserts = isArray(record.assert) && record.assert
                || record.assert && [record.assert]
                || [],
        
            ensure  = isArray(record.ensure) && record.ensure
                || record.ensure && [record.ensure]
                || [];
        
        asserts.push.apply(asserts, ensure);
        
        me._schema                    = record;
        graph._conceptLib[record._id] = this;
        if ( cKeys.length ) {
            this._openConcepts         = {};
            this._openConceptsRequires = {};
            
            cKeys.map(
                function ( v ) {
                    me._openConcepts[v]         = new Concept(record.childConcepts[v], graph, me);
                    me._openConceptsRequires[v] =
                        isArray(record.childConcepts[v].require) ? record.childConcepts[v].require
                            : record.childConcepts[v].require && [record.childConcepts[v].require] || [];
                }
            );
        }
        else
            this.isLeaf = true;
        
        // generate the assert fn
        this._assertTest =//@todo : mk a parser -.-
            new Function("scope", "graph",
                "try{" +
                "return (" +
                (
                    asserts.length &&
                    asserts.join(") && (")
                           .replace(/\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig, "scope.getRef(\"$1\")")
                    || "true"
                )
                + ");" +
                "}catch(e){" +
                "return undefined;" +
                "}"
            );
        this._id         = record._id;
        this._name       = record._name;
        this._parent     = parent;
        
        
    },
    /**
     * Search Parent concept by name
     * @param parent [Concept|undefined]
     */
    hasParent     : function ( cn ) {
        var c = this;
        while ( c = c._parent )
            if ( c._name === cn )
                return c;
    },
    /**
     * Search Parent concept by id
     * @param parent [Concept|undefined]
     */
    hasParentId   : function ( cid ) {
        var c = this;
        while ( c = c._parent )
            if ( c._id === cid )
                return c;
    },
    /**
     * Return an async task that will cast the applicable concepts
     * @param scope
     * @param graph
     * @returns {Function}
     */
    applyTo       : function ( scope, graph ) {
        var me                          = this;
        // will push or return task (or just inc some sema)
        scope._mappedConcepts[me._name] = me;
        
        
        return function ( graph, flow ) {
            //debug.log(graph.cfg.label + " : Do cast ", me._id, 'on', scope._._id);
            
            if ( me._schema.provider ) {// call the concept data provider
                var p         = isArray(me._schema.provider) ? me._schema.provider[0] : me._schema.provider,
                    argz      = isArray(me._schema.provider) && me._schema.provider.slice(1),
                    providers = graph.static._providers, checkTm;
                
                // stats
                
                let execTm = Date.now();
                
                p = p.split("::");
                if ( providers[p[0]] && providers[p[0]][p[1]] ) {
                    
                    flow.wait();// inc async flow
                    
                    //debug.info(graph.cfg.label + " : Do provider ", p, 'on', scope._._id);
                    try {
                        checkTm = setTimeout(() => {
                            debug.error(graph.cfg.label + " : Still waiting provider ", p, 'on', scope._._id)
                        }, 25000)
                        providers[p[0]][p[1]](
                            graph, me, scope, argz,
                            function ( e, r ) {
                                clearTimeout(checkTm);
                                
                                // stats
                                graph._statsByProvider[p] = graph._statsByProvider[p] || 0;
                                graph._statsByProvider[p] += (Date.now() - execTm);
                                
                                //debug.info(graph.cfg.label + " : Done provider ", p, 'on', scope._._id);
                                r && graph.pushMutation(r, scope._._id, 0, 0, 0, refs => {
                                    //debug.info(graph.cfg.label + " : Done provider ", p, 'on', scope._._id);
                                    flow.release()// w8 bagrefs b4 next cycle
                                });// so bagrefs will be w8 before the graph restart ... :/
                                e && debug.log("Hum provider ", p, " has failed : \n", e, e.stack);
                                ;// dec async flow
                            });
                    } catch ( e ) {
                        // clearInterval(checkTm);
                        debug.error(graph.cfg.label + " : Fail ! provider %s on %s \n%j\n", p, scope._._id, scope._, e);
                        setTimeout(() => {
                            throw e
                        });
                    }
                    
                }
                else {
                    scope.set(me._name, true, graph);// flagged by default
                    debug.log("Hum provider not found ", p, " :( \n");//@todo : deal with providers errors ?
                }
                
            }
            else if ( me._schema.type == "enum" ) {// enum are not used for now
                graph.pushMutation(
                    {
                        $_id      : "_parent",
                        [me._name]: me.isLeaf && [] || Object.keys(me._openConcepts)
                    },
                    scope._._id
                );
            }
            else {
                // scope.set(me._name, true, graph);
                graph.pushMutation(
                    {
                        $_id      : "_parent",
                        [me._name]: me._schema.defaultValue || true
                    },
                    scope._._id
                );
            }
            
            // if there a tpl in the concept definition apply it
            if ( me._schema.applyMutations ) {
                graph.pushMutation(me._schema.applyMutations, scope._._id);
            }
            // if the concept implies a graph sync (allowing concepts to be applied on server )
            if ( me._schema.syncAfter ) {
                // graph.stabilize(()=>graph.sync());
            }
        };
    },
    /**
     * return true if applicable (will ask ref with the follow param (so this concept will be retested if some of his
     * require is set)
     * @param obj
     *
     */
    isApplicableTo: function ( scope, graph ) {
        // will test the needed objects asserts
        if ( this._schema.autoCast === false ) {
            return;
        }
        
        var me       = this,
            requires = isArray(me._schema.require) && me._schema.require
                || me._schema.require && [me._schema.require]
                || [];
        requires     = requires.filter(function ( c ) {
            // scope._followStack.push(c, true);
            //console.log(c + " " + scope.getRef(c) );
            var ref = scope.getRef(c, true);
            return (!ref && (ref != 0)) && true || null;
        });

//        var res = !requires.length && this._assertTest(scope, graph) ? " -> YES" : " -> NO";
        //var res = !requires.length ? " -> YES" : " -> NO";
        //debug.log("Is Applicable " + this._name  + " " + res );
        
        return !requires.length
            && this._assertTest(scope, graph);// @optims
    },
    /**
     * Rm scope auto destabilise
     * @param scope
     * @param graph
     */
    unRefRequires : function ( scope, graph ) {//@todo
        var me       = this,
            requires = isArray(me._schema.require) && me._schema.require
                || me._schema.require && [me._schema.require]
                || [];
        requires     = requires.filter(function ( c ) {
            return !graph.getRef(c, scope, true, true) && true || null;
        });
    }
};
module.exports    = Concept;