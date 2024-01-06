const User = require('../models/userModel');
const Teacher = require('../models/teacherModel');
const File = require('../models/fileModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = (req, res, next) => {
    bcrypt.hash(req.body.upass, 10, function(err, hashedPass){
        if(err){
            res.json({error: err});
        }

        let user = new User({
            fname: req.body.fname,
            uname: req.body.uname,
            upass: hashedPass
        })
        user.save()
        .then((user) => {
            res.json({message: `Hi, ${user.fname}.`})
        })
        .catch((err) => {
            res.json({message: 'An error has occured somewhere.'})
        })
    })
}

const login = (req, res, next) => {
    var uname = req.body.uname;
    var upass = req.body.upass;

    User.findOne({uname})
        .then(user => {
            if(user){
                bcrypt.compare(upass, user.upass, function(err, result){
                    if(err){
                        res.json({error: err})
                    }
                    if(result){
                        let name = user.fname;
                        //let token = jwt.sign({name: user.fname}, 'verySecretValue', {expiresIn: '1h'})
                        /*res.json({
                            message: "Login successful.",
                            token
                        })*/
                        /*
                        User.findById('654c07e024b8d730ae5da734')
                            .then(tasks => {
                                res.render('profile', {user, token})
                            //})*/
                        //res.render('profile', {user, token});
                        
                        File.find({room: user.room},{_id: 1, originalName: 1, activity: 1, createdAt: 1})
                        .then(result => {
                            //FILELINK key should be dynamically inserted.
                            //res.render('index01', {result, name})
                            res.render('index01', {result, name, fileLink: 'http://localhost:3000/file/'})
                        })
                    } else {
                        res.json({message: "Password does not match."})
                    }
                })
            } else {
                res.json({message: "No user found."})
            }
        })
}

const loginTeacher = (req, res, next) => {
    var uid = req.body.uid;

    Teacher.findOne({uid},{_id: 1, fname: 1, roles: 1})
        .then((teacher) => {
            if(teacher){
                res.render('teacher', {teacher})
            } else {
                res.send({msg: 'Incorrect inputs.'})
                //res.json({errorMessage: 'Wrong ID. Try again.'})
            }
        })
        .catch(err => {
            console.log(err)
        })
}

module.exports = {register, login, loginTeacher}