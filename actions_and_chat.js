// Send a message to the attending or nurse
async function sendMessage() {
    if (!gameActive || !chatInput.value.trim()) return;
    
    const message = chatInput.value.trim();
    chatInput.value = '';
    
    // Determine the recipient based on prefix
    let recipient = 'system';
    let content = message;
    
    if (message.startsWith('@md:') || message.startsWith('@md ')) {
        recipient = 'attending';
        content = message.replace(/^@md:?\s*/, '');
    }

// Evaluate an order for scoring
async function evaluateOrder(orderDetails, result) {
    // Create a prompt for evaluating the order
    const evaluationPrompt = `
    Evaluate the medical appropriateness of the following order in the context of this patient case:
    
    Patient information:
    - Diagnosis (hidden from player): ${patientData.diagnosis}
    - Demographics: ${patientData.demographics}
    - Chief complaint: ${patientData.chiefComplaint}
    - History: ${patientData.history}
    
    Current vitals:
    - HR: ${vitalSigns.HR} bpm
    - BP: ${vitalSigns.BPSystolic}/${vitalSigns.BPDiastolic} mmHg
    - MAP: ${vitalSigns.MAP} mmHg
    - RR: ${vitalSigns.RR} breaths/min
    - Temp: ${vitalSigns.Temp}°C
    - O2Sat: ${vitalSigns.O2Sat}%
    
    Recent case history:
    ${caseHistory.slice(-8).map(event => `- ${formatGameTime(event.time)}: ${event.event}`).join('\n')}
    
    Order details:
    ${JSON.stringify(orderDetails, null, 2)}
    
    Order result:
    ${result}
    
    Please evaluate whether this order was:
    1. Appropriate and indicated (good clinical decision)
    2. Not harmful but unnecessary (wasteful)
    3. Potentially harmful or contraindicated (poor clinical decision)
    
    Return a JSON object with the following structure:
    {
      "evaluation": "appropriate" or "unnecessary" or "harmful",
      "scoreImpact": number between -10 and 0 (0 for appropriate, -1 to -3 for unnecessary, -4 to -10 for harmful),
      "feedback": "Brief explanation of the evaluation"
    }
    
    Consider standard of care guidelines, the patient's condition, and potential adverse effects in your evaluation.`;
    
    try {
        const response = await callAPI([{ role: "user", content: evaluationPrompt }]);
        const content = response.choices[0].message.content;
        
        // Try to extract JSON from the response
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/) || content.match(/{[\s\S]*?}/);
        
        if (jsonMatch) {
            const evaluation = JSON.parse(jsonMatch[0].replace(/```json\n|```\n|```/g, ''));
            
            // Update the score
            score += evaluation.scoreImpact;
            updateDisplays();
            
            // If the order was harmful, have the attending comment
            if (evaluation.evaluation === 'harmful' && Math.random() < 0.8) {
                setTimeout(() => {
                    addMessage('attending', `I'm concerned about your decision to ${getOrderSummary(orderDetails)}. ${evaluation.feedback}`);
                }, 3000);
            }
            
            // If the order was unnecessary, occasionally have the attending comment
            if (evaluation.evaluation === 'unnecessary' && Math.random() < 0.4) {
                setTimeout(() => {
                    addMessage('attending', `Was it necessary to ${getOrderSummary(orderDetails)}? ${evaluation.feedback}`);
                }, 3000);
            }
            
            // For appropriate orders that significantly improve the patient, have the nurse comment
            if (evaluation.evaluation === 'appropriate' && evaluation.scoreImpact === 0 && Math.random() < 0.3) {
                setTimeout(() => {
                    addMessage('nurse', `The patient seems to be responding well to your management.`);
                }, 5000);
            }
            
            return evaluation;
        }
    } catch (error) {
        console.error('Error evaluating order:', error);
    }
    
    return null;
}

// Generate a result for an order
async function generateOrderResult(orderDetails) {
    // Create a prompt for generating a result based on the order
    const resultPrompt = `
    Based on the following patient case and timeline of events, generate a realistic result for the ordered ${orderDetails.type}.
    
    Patient information:
    - Diagnosis (hidden from player): ${patientData.diagnosis}
    - Demographics: ${patientData.demographics}
    - Chief complaint: ${patientData.chiefComplaint}
    - History: ${patientData.history}
    
    Current vitals:
    - HR: ${vitalSigns.HR} bpm
    - BP: ${vitalSigns.BPSystolic}/${vitalSigns.BPDiastolic} mmHg
    - MAP: ${vitalSigns.MAP} mmHg
    - RR: ${vitalSigns.RR} breaths/min
    - Temp: ${vitalSigns.Temp}°C
    - O2Sat: ${vitalSigns.O2Sat}%
    
    Recent events:
    ${caseHistory.slice(-8).map(event => `- ${formatGameTime(event.time)}: ${event.event}`).join('\n')}
    
    Order details:
    ${JSON.stringify(orderDetails, null, 2)}
    
    Please provide a realistic, medically accurate result for this ${orderDetails.type} order. The response should be appropriate for the patient's underlying condition (${patientData.diagnosis}) but should not explicitly state the diagnosis.
    
    If this is a medication order, describe the patient's response to the medication.
    If this is a lab test, provide realistic lab values.
    If this is an imaging study, provide findings consistent with the underlying condition.
    If this is a procedure, describe the procedure and any findings.
    If this is a consultation, provide the consultant's assessment and recommendations.
    
    Keep the response focused and concise (about 3-5 sentences), as if it were appearing in an electronic medical record.`;
    
    try {
        const response = await callAPI([{ role: "user", content: resultPrompt }]);
        const content = response.choices[0].message.content;
        
        // Add the result to the results area
        addResult(content, 'result');
        
        // Add to case history
        caseHistory.push({
            time: inGameTime,
            event: `Result received: ${orderDetails.type}`,
            data: { 
                orderDetails, 
                result: content 
            }
        });
        
        // Check if the order affects the score
        await evaluateOrder(orderDetails, content);
        
    } catch (error) {
        console.error('Error generating order result:', error);
        addResult('Error: Could not retrieve result for this order.', 'error');
    }
}

// Generate a summary of an order for display
function getOrderSummary(orderDetails) {
    switch (orderDetails.type) {
        case 'medication':
            return `${orderDetails.medication} ${orderDetails.dosage} ${orderDetails.route} ${orderDetails.frequency}`;
        case 'lab':
            return `${getLableDisplayName(orderDetails.test)} (${orderDetails.urgency})`;
        case 'exam':
            return `${orderDetails.area} ${orderDetails.focus ? '- ' + orderDetails.focus : ''}`;
        case 'imaging':
            return `${orderDetails.study} - ${orderDetails.details} (${orderDetails.contrast === 'none' ? 'No contrast' : orderDetails.contrast + ' contrast'}, ${orderDetails.urgency})`;
        case 'procedure':
            return `${orderDetails.procedure} ${orderDetails.details ? '- ' + orderDetails.details : ''}`;
        case 'consult':
            return `${orderDetails.specialty} - ${orderDetails.reason} (${orderDetails.urgency})`;
        default:
            return '';
    }
}

// Get a display name for a lab test
function getLableDisplayName(labId) {
    const labNames = {
        'cbc': 'Complete Blood Count',
        'cmp': 'Comprehensive Metabolic Panel',
        'cardiac-enzymes': 'Cardiac Enzymes',
        'coagulation': 'Coagulation Studies',
        'abg': 'Arterial Blood Gas',
        'cultures': 'Cultures & Sensitivity',
        'urinalysis': 'Urinalysis',
        'other-labs': 'Other Laboratory Tests'
    };
    
    return labNames[labId] || labId;
}

// Submit an order
async function submitOrder(action, subActionId, subActionName) {
    if (!gameActive || actionInProgress) return;
    
    actionInProgress = true;
    
    // Get the order details based on the form
    let orderDetails = {};
    
    switch (action) {
        case 'drugs':
            const medication = document.getElementById('medication-select').value;
            const dosage = document.getElementById('dosage-input').value;
            const route = document.getElementById('route-select').value;
            const frequency = document.getElementById('frequency-select').value;
            
            if (!medication || !dosage) {
                alert('Please select a medication and specify a dosage.');
                actionInProgress = false;
                return;
            }
            
            orderDetails = {
                type: 'medication',
                medication,
                dosage,
                route,
                frequency,
                category: subActionId
            };
            break;
        case 'labs':
            const urgency = document.getElementById('urgency-select').value;
            const labNotes = document.getElementById('lab-notes').value;
            
            orderDetails = {
                type: 'lab',
                test: subActionId,
                urgency,
                notes: labNotes
            };
            break;
        case 'exam':
            const examFocus = document.getElementById('exam-focus').value;
            
            orderDetails = {
                type: 'exam',
                area: subActionId,
                focus: examFocus
            };
            break;
        case 'imaging':
            const imagingDetails = document.getElementById('imaging-details').value;
            const contrast = document.getElementById('contrast-select').value;
            const imagingUrgency = document.getElementById('imaging-urgency-select').value;
            
            if (!imagingDetails) {
                alert('Please specify the body region and clinical question.');
                actionInProgress = false;
                return;
            }
            
            orderDetails = {
                type: 'imaging',
                study: subActionId,
                details: imagingDetails,
                contrast,
                urgency: imagingUrgency
            };
            break;
        case 'procedures':
            const procedureDetails = document.getElementById('procedure-details').value;
            
            orderDetails = {
                type: 'procedure',
                procedure: subActionId,
                details: procedureDetails
            };
            break;
        case 'consults':
            const consultReason = document.getElementById('consult-reason').value;
            const consultUrgency = document.getElementById('consult-urgency-select').value;
            
            if (!consultReason) {
                alert('Please provide a reason for the consult.');
                actionInProgress = false;
                return;
            }
            
            orderDetails = {
                type: 'consult',
                specialty: subActionId,
                reason: consultReason,
                urgency: consultUrgency
            };
            break;
    }
    
    // Add to case history
    const orderEvent = `Ordered ${subActionName}: ${getOrderSummary(orderDetails)}`;
    caseHistory.push({
        time: inGameTime,
        event: orderEvent,
        data: orderDetails
    });
    
    // Display the order in the results area
    addResult(`Order placed: ${getOrderSummary(orderDetails)}`, 'order');
    
    // Hide the order form
    orderEntryArea.classList.add('hidden');
    subActionsArea.classList.add('hidden');
    
    // Increment cost
    incrementCost();
    
    // Generate a result for the order
    await generateOrderResult(orderDetails);
    
    actionInProgress = false;
}

// Get drug options based on the category
function getDrugOptions(category) {
    let options = '';
    
    switch (category) {
        case 'cardiac':
            options = `
                <option value="">Select medication...</option>
                <option value="metoprolol">Metoprolol</option>
                <option value="atenolol">Atenolol</option>
                <option value="carvedilol">Carvedilol</option>
                <option value="losartan">Losartan</option>
                <option value="lisinopril">Lisinopril</option>
                <option value="amlodipine">Amlodipine</option>
                <option value="diltiazem">Diltiazem</option>
                <option value="digoxin">Digoxin</option>
                <option value="furosemide">Furosemide</option>
                <option value="spironolactone">Spironolactone</option>
                <option value="hydrochlorothiazide">Hydrochlorothiazide</option>
                <option value="nitroglycerin">Nitroglycerin</option>
                <option value="isosorbide">Isosorbide</option>
                <option value="amiodarone">Amiodarone</option>
                <option value="dobutamine">Dobutamine</option>
                <option value="dopamine">Dopamine</option>
                <option value="epinephrine">Epinephrine</option>
                <option value="norepinephrine">Norepinephrine</option>
                <option value="vasopressin">Vasopressin</option>
                <option value="aspirin">Aspirin</option>
                <option value="clopidogrel">Clopidogrel</option>
                <option value="ticagrelor">Ticagrelor</option>
                <option value="heparin">Heparin</option>
                <option value="enoxaparin">Enoxaparin</option>
                <option value="warfarin">Warfarin</option>
                <option value="statin">Statin</option>
            `;
            break;
        case 'antibiotics':
            options = `
                <option value="">Select medication...</option>
                <option value="ampicillin">Ampicillin</option>
                <option value="amoxicillin">Amoxicillin</option>
                <option value="amoxicillin/clavulanate">Amoxicillin/Clavulanate</option>
                <option value="azithromycin">Azithromycin</option>
                <option value="ceftriaxone">Ceftriaxone</option>
                <option value="cefepime">Cefepime</option>
                <option value="cefazolin">Cefazolin</option>
                <option value="ciprofloxacin">Ciprofloxacin</option>
                <option value="levofloxacin">Levofloxacin</option>
                <option value="doxycycline">Doxycycline</option>
                <option value="metronidazole">Metronidazole</option>
                <option value="vancomycin">Vancomycin</option>
                <option value="piperacillin/tazobactam">Piperacillin/Tazobactam</option>
                <option value="meropenem">Meropenem</option>
                <option value="imipenem/cilastatin">Imipenem/Cilastatin</option>
                <option value="linezolid">Linezolid</option>
                <option value="clindamycin">Clindamycin</option>
                <option value="trimethoprim/sulfamethoxazole">Trimethoprim/Sulfamethoxazole</option>
                <option value="fluconazole">Fluconazole</option>
                <option value="acyclovir">Acyclovir</option>
                <option value="oseltamivir">Oseltamivir</option>
            `;
            break;
        case 'analgesics':
            options = `
                <option value="">Select medication...</option>
                <option value="acetaminophen">Acetaminophen</option>
                <option value="ibuprofen">Ibuprofen</option>
                <option value="ketorolac">Ketorolac</option>
                <option value="morphine">Morphine</option>
                <option value="hydromorphone">Hydromorphone</option>
                <option value="fentanyl">Fentanyl</option>
                <option value="oxycodone">Oxycodone</option>
                <option value="tramadol">Tramadol</option>
                <option value="gabapentin">Gabapentin</option>
                <option value="pregabalin">Pregabalin</option>
            `;
            break;
        case 'fluids':
            options = `
                <option value="">Select fluid...</option>
                <option value="normal-saline">Normal Saline (0.9% NaCl)</option>
                <option value="lactated-ringers">Lactated Ringer's</option>
                <option value="d5w">D5W</option>
                <option value="d5ns">D5 Normal Saline</option>
                <option value="d5-half-ns">D5 Half Normal Saline</option>
                <option value="d50">D50</option>
                <option value="albumin">Albumin</option>
                <option value="blood">Packed Red Blood Cells</option>
                <option value="platelets">Platelets</option>
                <option value="ffp">Fresh Frozen Plasma</option>
            `;
            break;
        case 'respiratory':
            options = `
                <option value="">Select medication...</option>
                <option value="albuterol">Albuterol</option>
                <option value="ipratropium">Ipratropium</option>
                <option value="budesonide">Budesonide</option>
                <option value="fluticasone">Fluticasone</option>
                <option value="salmeterol">Salmeterol</option>
                <option value="tiotropium">Tiotropium</option>
                <option value="montelukast">Montelukast</option>
                <option value="prednisone">Prednisone</option>
                <option value="methylprednisolone">Methylprednisolone</option>
            `;
            break;
        case 'other-meds':
            options = `
                <option value="">Select medication...</option>
                <option value="insulin">Insulin</option>
                <option value="metformin">Metformin</option>
                <option value="levothyroxine">Levothyroxine</option>
                <option value="hydrocortisone">Hydrocortisone</option>
                <option value="pantoprazole">Pantoprazole</option>
                <option value="famotidine">Famotidine</option>
                <option value="ondansetron">Ondansetron</option>
                <option value="metoclopramide">Metoclopramide</option>
                <option value="lorazepam">Lorazepam</option>
                <option value="haloperidol">Haloperidol</option>
                <option value="phenytoin">Phenytoin</option>
                <option value="levetiracetam">Levetiracetam</option>
                <option value="other">Other (specify in notes)</option>
            `;
            break;
        default:
            options = '<option value="">Select medication...</option>';
    }
    
    return options;
} else if (message.startsWith('@rn:') || message.startsWith('@rn ')) {
        recipient = 'nurse';
        content = message.replace(/^@rn:?\s*/, '');
    } else {
        // If no prefix, default to attending
        recipient = 'attending';
    }
    
    // Add the player's message to the chat
    addMessage('player', message);
    
    // Increment cost
    incrementCost();
    
    // Generate a response from the recipient
    await generateResponse(recipient, content);
}

// Generate a response from the attending or nurse
async function generateResponse(recipient, message) {
    const context = `
    You are role-playing as a ${recipient === 'attending' ? 'teaching attending physician' : 'experienced nurse'} in a medical simulation for internal medicine residents.
    
    Current patient information:
    - Demographics: ${patientData.demographics}
    - Chief complaint: ${patientData.chiefComplaint}
    - History: ${patientData.history}
    - Actual diagnosis (hidden from player): ${patientData.diagnosis}
    
    Current vitals:
    - HR: ${vitalSigns.HR} bpm
    - BP: ${vitalSigns.BPSystolic}/${vitalSigns.BPDiastolic} mmHg
    - MAP: ${vitalSigns.MAP} mmHg
    - RR: ${vitalSigns.RR} breaths/min
    - Temp: ${vitalSigns.Temp}°C
    - O2Sat: ${vitalSigns.O2Sat}%
    
    Recent case events:
    ${caseHistory.slice(-5).map(event => `- ${formatGameTime(event.time)}: ${event.event}`).join('\n')}
    
    ${recipient === 'attending' ? 
        'As the attending, give medically accurate guidance, ask probing questions, and evaluate the resident\'s medical decision-making. Be supportive but appropriately critical when needed. Do not directly tell them the diagnosis.' : 
        'As the nurse, respond to the resident\'s requests, provide observations about the patient, and relay information as a real nurse would. You can perform basic nursing tasks if requested.'}
    
    The resident has sent this message: "${message}"
    
    Respond in a realistic, conversational manner as a ${recipient === 'attending' ? 'teaching attending physician' : 'nurse'}.
    Keep your response concise (1-3 sentences) unless detailed medical explanation is necessary.`;
    
    try {
        const response = await callAPI([{ role: "user", content: context }]);
        const content = response.choices[0].message.content;
        
        // Add the response to the chat
        addMessage(recipient, content);
        
    } catch (error) {
        console.error(`Error generating ${recipient} response:`, error);
        addMessage('system', `Error: Could not get a response from the ${recipient}.`);
    }
}

// Handle action button clicks
function handleAction(action) {
    // Hide any sub-menus and order forms
    subActionsArea.innerHTML = '';
    orderEntryArea.innerHTML = '';
    
    // Show sub-actions for the selected action
    subActionsArea.classList.remove('hidden');
    
    // Generate sub-actions based on the selected action
    let subActions = [];
    
    switch (action) {
        case 'drugs':
            subActions = [
                { id: 'cardiac', name: 'Cardiac Medications' },
                { id: 'antibiotics', name: 'Antibiotics' },
                { id: 'analgesics', name: 'Pain Management' },
                { id: 'fluids', name: 'IV Fluids' },
                { id: 'respiratory', name: 'Respiratory Medications' },
                { id: 'other-meds', name: 'Other Medications' }
            ];
            break;
    }
    
    // Add submit and cancel buttons
    formHtml += `
        <div class="form-buttons">
            <button id="submit-order" class="action-button">Submit Order</button>
            <button id="cancel-order" class="action-button" style="background-color: #e74c3c;">Cancel</button>
        </div>
    `;
    
    orderEntryArea.innerHTML = formHtml;
    
    // Add event listeners for the form buttons
    document.getElementById('submit-order').addEventListener('click', () => {
        submitOrder(action, subActionId, subActionName);
    });
    
    document.getElementById('cancel-order').addEventListener('click', () => {
        orderEntryArea.classList.add('hidden');
    });
}
        case 'labs':
            subActions = [
                { id: 'cbc', name: 'Complete Blood Count' },
                { id: 'cmp', name: 'Comprehensive Metabolic Panel' },
                { id: 'cardiac-enzymes', name: 'Cardiac Enzymes' },
                { id: 'coagulation', name: 'Coagulation Studies' },
                { id: 'abg', name: 'Arterial Blood Gas' },
                { id: 'cultures', name: 'Cultures & Sensitivity' },
                { id: 'urinalysis', name: 'Urinalysis' },
                { id: 'other-labs', name: 'Other Laboratory Tests' }
            ];
            break;
        case 'exam':
            subActions = [
                { id: 'vitals', name: 'Check Vital Signs' },
                { id: 'general', name: 'General Examination' },
                { id: 'cardiac', name: 'Cardiac Examination' },
                { id: 'respiratory', name: 'Respiratory Examination' },
                { id: 'abdominal', name: 'Abdominal Examination' },
                { id: 'neuro', name: 'Neurological Examination' },
                { id: 'musculoskeletal', name: 'Musculoskeletal Examination' },
                { id: 'other-exam', name: 'Other Examination' }
            ];
            break;
        case 'imaging':
            subActions = [
                { id: 'xray', name: 'X-Ray' },
                { id: 'ct', name: 'CT Scan' },
                { id: 'mri', name: 'MRI' },
                { id: 'ultrasound', name: 'Ultrasound' },
                { id: 'echo', name: 'Echocardiogram' },
                { id: 'other-imaging', name: 'Other Imaging' }
            ];
            break;
        case 'procedures':
            subActions = [
                { id: 'ekg', name: 'ECG/EKG' },
                { id: 'iv-access', name: 'IV Access' },
                { id: 'oxygen', name: 'Oxygen Therapy' },
                { id: 'intubation', name: 'Intubation' },
                { id: 'catheter', name: 'Catheterization' },
                { id: 'lumbar-puncture', name: 'Lumbar Puncture' },
                { id: 'paracentesis', name: 'Paracentesis' },
                { id: 'thoracentesis', name: 'Thoracentesis' },
                { id: 'cpr', name: 'CPR' },
                { id: 'other-procedure', name: 'Other Procedure' }
            ];
            break;
        case 'consults':
            subActions = [
                { id: 'cardiology', name: 'Cardiology' },
                { id: 'pulmonology', name: 'Pulmonology' },
                { id: 'gastroenterology', name: 'Gastroenterology' },
                { id: 'neurology', name: 'Neurology' },
                { id: 'infectious-disease', name: 'Infectious Disease' },
                { id: 'nephrology', name: 'Nephrology' },
                { id: 'surgery', name: 'Surgery' },
                { id: 'icu', name: 'ICU Transfer' },
                { id: 'other-consult', name: 'Other Consult' }
            ];
            break;
        default:
            subActions = [];
            break;
    }
    
    // Create sub-action buttons
    subActionsArea.innerHTML = `<h3>${action.charAt(0).toUpperCase() + action.slice(1)}</h3>`;
    
    subActions.forEach(subAction => {
        const button = document.createElement('button');
        button.className = 'action-button';
        button.textContent = subAction.name;
        button.dataset.id = subAction.id;
        button.dataset.parentAction = action;
        
        button.addEventListener('click', () => {
            handleSubAction(action, subAction.id, subAction.name);
        });
        
        subActionsArea.appendChild(button);
    });
    
    // Add back button
    const backButton = document.createElement('button');
    backButton.className = 'action-button';
    backButton.style.backgroundColor = '#e74c3c';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', () => {
        subActionsArea.classList.add('hidden');
    });
    subActionsArea.appendChild(backButton);
}

// Handle sub-action button clicks
function handleSubAction(action, subActionId, subActionName) {
    // Show order entry form
    orderEntryArea.classList.remove('hidden');
    
    // Create a form based on the selected action and sub-action
    let formHtml = `<h3>${subActionName}</h3>`;
    
    switch (action) {
        case 'drugs':
            formHtml += `
                <p>Select medication and dosage:</p>
                <select id="frequency-select">
                    <option value="once">Once</option>
                    <option value="q4h">q4h</option>
                    <option value="q6h">q6h</option>
                    <option value="q8h">q8h</option>
                    <option value="q12h">q12h</option>
                    <option value="daily">Daily</option>
                    <option value="BID">BID</option>
                    <option value="TID">TID</option>
                    <option value="QID">QID</option>
                    <option value="PRN">PRN</option>
                    <option value="continuous">Continuous</option>
                </select>
            `;
            break;
        case 'labs':
            formHtml += `
                <p>Order ${subActionName}:</p>
                <select id="urgency-select">
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                </select>
                <textarea id="lab-notes" placeholder="Additional notes or specific tests..."></textarea>
            `;
            break;
        case 'exam':
            formHtml += `
                <p>Perform ${subActionName}:</p>
                <textarea id="exam-focus" placeholder="Specific areas to examine or questions to answer..."></textarea>
            `;
            break;
        case 'imaging':
            formHtml += `
                <p>Order ${subActionName}:</p>
                <textarea id="imaging-details" placeholder="Body region and clinical question..."></textarea>
                <select id="contrast-select">
                    <option value="none">No Contrast</option>
                    <option value="oral">Oral Contrast</option>
                    <option value="iv">IV Contrast</option>
                    <option value="both">Both Oral and IV Contrast</option>
                </select>
                <select id="imaging-urgency-select">
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                </select>
            `;
            break;
        case 'procedures':
            formHtml += `
                <p>Order ${subActionName}:</p>
                <textarea id="procedure-details" placeholder="Specific details and reason..."></textarea>
            `;
            break;
        case 'consults':
            formHtml += `
                <p>Request ${subActionName} Consult:</p>
                <textarea id="consult-reason" placeholder="Reason for consult and specific questions..."></textarea>
                <select id="consult-urgency-select">
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                </select>
            `;
            break; id="medication-select">
                    ${getDrugOptions(subActionId)}
                </select>
                <input type="text" id="dosage-input" placeholder="Dosage (e.g., 5mg)">
                <select id="route-select">
                    <option value="IV">IV</option>
                    <option value="PO">PO</option>
                    <option value="IM">IM</option>
                    <option value="SC">SC</option>
                    <option value="Inhaled">Inhaled</option>
                    <option value="Topical">Topical</option>
                </select>
                <select