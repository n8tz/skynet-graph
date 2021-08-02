/**
 * Copyright (C) 2021  Nathanael Braun
 
 * @author Nathanael BRAUN
 *
 * Date: 14/01/2016
 * Time: 13:23
 */

var Entity = require('./Entity');

function Node( _, graph, parentMutation ) {
    this.init(_, graph);
};
Node.prototype = {
    init              : function ( _, graph, parentMutation ) {
        this._outgoing = [];
        this._incoming = [];
        this._id       = _._id;

        this._etty = new Entity(
            {
                _id     : _._id,
                Node : true
            },
            graph
        );

        graph._mapsByConcept["Node"]=graph._mapsByConcept["Node"]||[];
        graph._mapsByConcept["Node"].push(_._id);

        !__SERVER__ && this._etty.follow("_autokill", this._killMe, this);

        this._etty.update(_,graph);
    },
    _killMe: function ( n, o ) {
        this._etty.unRefAll();
    },
    specialize        : function () {
        return this._etty.specialize();
    }
};

module.exports = Node;