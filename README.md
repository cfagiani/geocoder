geocoder
========

Geocoding service based on TIGER files


Steps to set up:

*  Install gdal (http://www.gdal.org/)
* Get TIGER shape files (http://www.census.gov/geo/maps-data/data/tiger-line.html)
* Convert shapefile to GeoJSON:
	```ogr2ogr -f "GeoJSON" output_features.json input_features.shp```
* load into mongo
	```mongoimport -d geo -c features output_features.json```
* convert address range fields to numbers and save street name as uppercase:

```
db.features.find({properties: {$exists:true}, "properties.FULLNAME" : {$ne: null}}).forEach( function(doc) {
 db.features.update(
   { _id: doc._id},
   { $set : {
     "nameupper": doc.properties.FULLNAME.toUpperCase(),
     "properties.RFROMADD" : parseInt(doc.properties.RFROMADD),
     "properties.RTOADD" : parseInt(doc.properties.RTOADD),
     "properties.LFROMADD" : parseInt(doc.properties.LFROMADD),
     "properties.LTOADD" : parseInt(doc.properties.LTOADD)
     } }
  )
})
```

* create spatial index (from mongo shell):
```
	db.features.ensureIndex({geometry:"2dsphere"})
```
* test the query:
```
	 db.features.find( { geometry : {$nearSphere : { $geometry : { type: "Point" , coordinates: [-78.767779, 43.034796]}, $maxDistance: 100 }}})
```