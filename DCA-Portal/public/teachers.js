let classroomSubject;

fetch('/teacher/index/' + document.querySelector('input[type="hidden"]').value)
    .then(function(response){
        //console.log(response.json())
        response.json()
        .then(data => {
            classroomSubject = data;

            const selectClassroom = document.getElementById('classroom'),
                selectSubject = document.getElementById('subject'),
                selectFile = document.getElementById('file'),
                selects = document.querySelectorAll('select');

                selects.forEach(select => {
                    if(select.disabled == true){
                        select.style.cursor = "auto";
                    }
                })

                for(let classroom in classroomSubject){
                    //console.log(classroom);
                    selectClassroom.options[selectClassroom.options.length] = new Option(classroom, classroom);
                }

                selectClassroom.onchange = (e) => {
                    selectSubject.disabled = false;
                    selectFile.disabled = true;

                    selectSubject.length = 1;

                    for(let subject in classroomSubject[e.target.value]){
                        let x = classroomSubject[e.target.value][subject];
                        selectSubject.options[selectSubject.options.length] = new Option(x, x);
                    }
                }

                selectSubject.onchange = (e) => {
                    selectFile.disabled = false;
                }
            
        })
    })

    
