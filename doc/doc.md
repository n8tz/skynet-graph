
## Objectifs

Les principaux objectifs du graphe sont :
- Permettre un enrichissement générique des chemins via l'exploration de sources de données multiples.
- Permettre une géneration de nouveaux chemins générique en se basant sur les données obtenue dynamiquement
- Permettre une synchronisation constante entre le serveur et le client afin, entre autre, de permettre l'edition collaborative de graphe. Mais aussi de répartir les requêtes générées.

## Principes, architecture, Concepts & entities


Afin de permettre un enrichissement dynamique et générique des données, le graphe utilise un système théoriquement proche des grammaires en théorie des langages.

En "théorie" chaque régle décrit une serie de symboles qui, si ils sont présent et vérifie certaines contraintes, généreront d'autre symboles.

Dans le graphe, des entités appelé 'concepts' joue le role de régle, et les objets du graphe (noeuds, segments, records), nommé "entity" sont les contextes sur lesquels s'appliquent ces concepts.
Les symboles étant quant à eux, assimilé aux clefs ou valeurs accessible dans le graphe.

Le graphe applique donc, tant que possible, pour chaque objet les concepts applicable en fonction des concepts & données déjà présents.

Quant plus aucun concept n'est applicable, le graphe est considéré comme 'stable'.

Lors de l'application d'un concepts, une série de mutations est appliquée. Celles ci peuvent soit être implicitement définie dans le concept, soit être généré par une fonction provider synchrone ou asynchrone.

Les concepts peuvent aussi être dynamique, si les conditions de leur application ne sont plus remplie, ils peuvent être automatiquement supprimé / nettoyée.

Le graphe est synchronisé "en temps réél" / atomiquement entre le serveur et le client, différents sets de concepts sont disponible et s'appliquent en fonction du contexte (client, serveur, graphe d'exploration)

A noter que toute mutation appliqué au graphe serveur est automatiquement diffusé à tout les clients utilisant le graphe courant. A l'inverse, le graphe client, ne push ses mutations qu'à la demande.

3 types d'objets source sont consideré par le graphe et les jeux de concepts :

### 1 - Noeuds

    {
        Node : true // entry point
    }

### 2 - Segments


    {
        Segment : true// concept's EP
        originNode : {objId} // auto référencé
        targetNode : {objId}
    }

### 3 - Documents


    {
        Record : true
    }


## Références

Afin de cibler & référencer simplement et relativement les valeurs dans le graphe on utilise une syntaxe dédié:

     (\$someId)?((hashMapKey.)|(referenceKey:))*(anyTargetKey)

Dans les assert, ensure & follow, on rajoute un $ pour différencier les références des valeurs numériques

     \$((hashMapKey.)|(referenceKey:))*(anyTargetKey)


## Template de mutations

Afin de permettre de muter le graphe de façon "atomique" et scalable, un langage de templates y est dédié.

### Exemple/schéma

    [
     {
       "$_id": "_parent", // ajoute les clefs de cet objet sur l'objet ou s'applique le concept d'origine de cette mutation
       "SomeConcept": true,// applique "de force" un concept (ses providers & tpl seront ignorés)
       "Distance":null,// null will uncast the concept
       "$originNode": "localReference",
       "$targetNode": "$someGraphObjId" // value of key starting with '$' will be evaluated from the _parent scope
     },
     {
       "_id": "localReference", // new node
       "Node":true,
       "$pathDescriptor": "someDescriptor"
     },
     {
       "_id": "someDescriptor", // path descriptor are included when parsing paths
       "Record":true,
       "$parentPathDescriptor": "someParentDescriptor"// parent path descriptors are recursivly included too
     },
     {
       "_id": "someParentDescriptor",
       "Record":true
     }
     ]

## Concepts
### Définition

Les concepts sont groupé par "concept set", chacun s'appliquant dans des contextes différents.

Dans ces sets de concepts, les concepts sont organisée hiérarchiquement; si un répertoire porte le nom d'un concept et que ce concept existe (cad une clefs du nom du concept existe sur le contexte d'application), les concepts présent dans ce répertoire deviennent potentiellement applicable.

Enfin si un concept est supprimé, ses concepts enfant sont préalablement supprimés.

### Schéma

Un concept est considéré comme appliqué si une clefs (du nom du concept) existe sur l'objet avec une valeur != de undefined

```
    {
      "autoCast":false,// si false le concepts n'est pas appliqué automatiquement
                       //par cette définition/contexte

      "syncAfter":true,// provoque une synchronisation du client vers le serveur
                       // dés que le graphe est stable (des concepts serveurs pourront alors s'appliquer)

      "require": [ // N'applique ce concept que si les valeurs suivante existe :
        "originNode:Position",// Position sur l'objet référencé dans originNode
        "targetNode:Position"// same
      ],
      "assert" : [// N'appliquer ce concept que si les condition suivantes sont remplie
        "$value == 8"
      ],
      "ensure" : [// Pareil qu'assert mais supprime le concept si la condition n'est plus remplie
        "$value == 8"
      ],
      "follow" : [// Réapplique le concept à chaque update de stuffSomewhere
        "$someRef:stuffSomewhere"
      ],
      "provider": [// fonction à appeler lors de l'application du concept
        "Common::Distance",
        {},"arg"// arguments...
      ],
      "cleaner": [ // fonction à appeller lors de la suppression d'un concept
        "User::UnCastWidget"
      ],
      "defaultValue": ["some", "values"], // valeur du concept par default si appliqué sans tpl/provider

      "applyMutations": [// template de mutation appliqué par default lors du cast du concept
        {
          "$_id":"_parent",
          "MyConcept" : true // l'application d'un concept doit créer une clefs à son nom
        }
      ]
    }
```