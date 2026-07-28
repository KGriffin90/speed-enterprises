# Data Processing Addendum (DPA)

**Effective date:** {{EFFECTIVE_DATE}}
**Last updated:** {{LAST_UPDATED}}

This Data Processing Addendum ("DPA") forms part of the [Business Services Agreement](/legal/business-services-agreement) (the "Agreement") between {{COMPANY_LEGAL_NAME}} ("{{COMPANY_SHORT_NAME}}," "Processor," "we," or "us") and the Business Customer ("Controller," "you") and governs the Processing of Personal Data by us on your behalf in connection with {{PLATFORM_NAME}} (the "Service"). If you require a signed counterpart, contact {{LEGAL_EMAIL}}. In the event of a conflict between this DPA and the Agreement regarding the Processing of Personal Data, this DPA controls.

## 1. Definitions

"**Data Protection Laws**" means all laws applicable to the Processing of Personal Data under the Agreement, including the EU General Data Protection Regulation 2016/679 ("**GDPR**"), the UK GDPR and Data Protection Act 2018 ("**UK GDPR**"), the Swiss Federal Act on Data Protection, the California Consumer Privacy Act as amended by the CPRA ("**CCPA/CPRA**"), and other U.S. state privacy laws, as applicable. "**Personal Data**," "**Processing**," "**Controller**," "**Processor**," "**Data Subject**," "**Supervisory Authority**," and "**Personal Data Breach**" have the meanings given in the applicable Data Protection Laws. Under the CCPA/CPRA, "**Business**" corresponds to Controller and "**Service Provider**" corresponds to Processor.

## 2. Roles and scope

You are the Controller/Business of the Personal Data you submit to or collect through the Service (including data about your customers and staff). We act as your Processor/Service Provider and Process such Personal Data only to provide the Service and as set out in this DPA. The subject matter, duration, nature, and purpose of Processing, the types of Personal Data, and the categories of Data Subjects are described in **Annex I**. Where we determine the means and purposes of certain processing for our own purposes (e.g., billing, platform security, product improvement using de-identified data), we act as an independent controller and our [Privacy Policy](/legal/privacy-policy) applies.

## 3. Processing instructions

We will Process Personal Data only on your documented instructions, including those given through the Service's features and configuration, unless required by law (in which case we will inform you unless legally prohibited). You are responsible for the lawfulness of your instructions and of your collection and use of Personal Data. We will inform you if, in our opinion, an instruction infringes Data Protection Laws.

## 4. Service Provider / CCPA commitments

With respect to Personal Data subject to the CCPA/CPRA, we: (a) will not **sell** or **share** the Personal Data (as those terms are defined under the CCPA/CPRA); (b) will not retain, use, or disclose it for any purpose other than the business purposes specified in the Agreement, including not for any commercial purpose other than providing the Service, except as permitted by law; (c) will not retain, use, or disclose it outside the direct business relationship between you and us; (d) will not combine it with Personal Data received from other sources, except as permitted by the CCPA/CPRA; and (e) certify that we understand and will comply with these restrictions. We will assist you in responding to consumer requests and will enable you to remediate unauthorized use as required.

## 5. Confidentiality and personnel

We will ensure that personnel authorized to Process Personal Data are bound by appropriate confidentiality obligations and are trained on their responsibilities, and we limit access to those who need it to provide the Service.

## 6. Security

We will implement and maintain appropriate technical and organizational measures designed to protect Personal Data against accidental or unlawful destruction, loss, alteration, unauthorized disclosure, or access, taking into account the state of the art and the risks involved. Current measures are summarized in **Annex II** and include encryption in transit, hashed credentials, per-tenant database isolation, access controls including row-level security, scoped/revocable authentication tokens, and audit logging.

## 7. Subprocessors

You provide general authorization for us to engage subprocessors to Process Personal Data, provided that we: (a) impose data-protection obligations on each subprocessor that are no less protective than this DPA; and (b) remain liable for each subprocessor's performance. Our current subprocessors are listed at [Subprocessors](/legal/subprocessors). We will provide a mechanism to be notified of new subprocessors and a reasonable period to object on legitimate data-protection grounds before the new subprocessor begins Processing; if you reasonably object and we cannot accommodate the objection, you may terminate the affected Service.

## 8. Data Subject and consumer requests

Taking into account the nature of the Processing, we will provide reasonable assistance (including appropriate technical and organizational measures, and the Service's self-service tools) to help you respond to requests from Data Subjects/consumers to exercise their rights (access, correction, deletion, portability, objection, restriction, and opt-out) under Data Protection Laws. If we receive such a request directly, we will, where permitted, refer the Data Subject to you.

## 9. Personal Data Breach

We will notify you **without undue delay** after becoming aware of a Personal Data Breach affecting your Personal Data, and will provide information reasonably available to us to help you meet your notification obligations. We will take reasonable steps to mitigate and remediate. Our notification is not an acknowledgement of fault.

## 10. Data Protection Impact Assessments

Taking into account the nature of Processing and information available to us, we will provide reasonable assistance with data-protection impact assessments and prior consultations with Supervisory Authorities, as required by Data Protection Laws.

## 11. International transfers

Where Processing involves the transfer of Personal Data from the EEA, UK, or Switzerland to a country without an adequacy decision, the parties agree that the applicable **Standard Contractual Clauses (SCCs)** (Module Two: Controller-to-Processor, and Module Three where onward transfer to a subprocessor occurs), as supplemented by the **UK International Data Transfer Addendum** and any Swiss adaptations, are incorporated into this DPA by reference and completed using the information in **Annex I and III**, with {{COMPANY_SHORT_NAME}} as "data importer" and you as "data exporter." Where there is a conflict, the SCCs prevail for transfers they govern.

## 12. Audits

We will make available information reasonably necessary to demonstrate compliance with this DPA and will allow for and contribute to audits, including inspections, conducted by you or an auditor you mandate, subject to reasonable notice, confidentiality, frequency limits, and our security policies. We may satisfy audit requests by providing third-party certifications or reports where available.

## 13. Return and deletion

Upon termination or expiry of the Agreement, we will, at your choice, delete or return Personal Data and delete existing copies, except to the extent retention is required by law or for the establishment, exercise, or defense of legal claims. The Service's export tools may be used to retrieve data during the period stated in the Agreement.

## 14. Liability and term

Each party's liability under this DPA is subject to the limitations and exclusions of liability in the Agreement. This DPA takes effect on the Effective Date and remains in effect for as long as we Process Personal Data on your behalf.

---

## Annex I — Description of Processing

- **Data exporter / Controller:** the Business Customer identified in the account.
- **Data importer / Processor:** {{COMPANY_LEGAL_NAME}}, {{POSTAL_ADDRESS}}, {{LEGAL_EMAIL}}.
- **Subject matter:** provision of the {{PLATFORM_NAME}} Service.
- **Duration:** the term of the Agreement plus any legally required retention.
- **Nature and purpose:** hosting, storage, transmission, and processing of Personal Data to operate quote intake, scheduling, communications, and related business operations.
- **Categories of Data Subjects:** the Business Customer's customers and prospective customers; the Business Customer's owners, administrators, and staff.
- **Categories of Personal Data:** identity and contact data (name, email, phone, address); service/quote details and notes; uploaded photos and measurements; appointment data; device/log data (IP, user-agent); for staff: time-tracking, pay/mileage, and precise geolocation while on the clock (foreground only).
- **Special categories:** none intentionally collected. Precise geolocation (staff) is treated as sensitive under certain U.S. laws.
- **Frequency:** continuous, for the duration of the Agreement.

## Annex II — Technical and organizational security measures

Encryption of data in transit (TLS); credentials stored using Argon2id hashing; per-tenant database isolation; database access controls including row-level security; least-privilege access for personnel; scoped, expiring, revocable authentication tokens; audit logging of sensitive actions; secure software-development practices; and incident-response procedures. Measures may be updated provided protection is not materially decreased.

## Annex III — Transfer mechanism details

For transfers subject to the GDPR/UK GDPR/Swiss FADP, the SCCs (and UK Addendum / Swiss adaptations) apply as described in Section 11. Governing law and supervisory authority for the SCCs: as selected by the parties consistent with the SCCs (defaulting to Ireland for EU transfers, the ICO for UK transfers, and the FDPIC for Swiss transfers, unless otherwise agreed). Docking, audits, and subprocessor terms align with Sections 7 and 12.
