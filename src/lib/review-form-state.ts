export interface ReviewFormFields {
  documentType: string;
  supplierName: string;
  documentNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  lineItems: string;
}

export interface ReviewFormState {
  message: string | null;
  fields: ReviewFormFields | null;
  formKey: string;
}

export const INITIAL_REVIEW_FORM_STATE: ReviewFormState = {
  message: null,
  fields: null,
  formKey: "initial"
};
