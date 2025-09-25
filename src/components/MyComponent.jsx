import React, { Component } from 'react';


class MyComponent extends React.Component {

    state ={
        name: "",
        email: ""
    };

    handleSubmit =(e) => {
        
         
        e.preventDefault();   //Prevents refresh during submit 
        console.log(this.state);

        const {name, email} = this.state;

        //Validation
        if(!name.trim()) return alert("Please enter your name");
        if(!email.includes("@")) return alert("Please enter a valid email");

        const ok = window.confirm(`Confirm Submission:\n\nName: ${name}\nEmail: ${email}`);
        if(ok) {
            alert('Submission Confirmed!');
            this.setState({name: "", email: ""});
        }
        else{
            alert('Submission Cancelled');
        }
    };

    render() {
        return(
            <>
            <p>This is a reusable component!</p>
            <div className="Submition-Form" id="submition_form">
                <form onSubmit={this.handleSubmit}>
                    <input
                    name="name"
                    type="text" 
                    placeholder="Your name"
                    value = {this.state.name}
                    onChange = {(e) => this.setState({name: e.target.value})}    
                    
                    /><br></br>
                    <input 
                    name="email"
                    type="email" 
                    placeholder="Your email"
                    value = {this.state.email}
                    onChange = {(e) => this.setState({email: e.target.value})}

                    /><br></br>
                    <button type="submit">Submit</button>
                </form>
            
            </div>
            </>
        );
    }


}

export default MyComponent